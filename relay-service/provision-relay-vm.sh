#!/bin/bash
# Provisions (or repairs) the ZKTeco ADMS relay VM.
#
# Run this FROM THIS DIRECTORY on the target VM, e.g.:
#   scp -r relay-service/ sitedes@<vm>:~/relay-src/
#   ssh sitedes@<vm> 'sudo bash ~/relay-src/provision-relay-vm.sh'
#
# It replaces the original setup-zkteco-relay.sh, which predated the relay
# and configured nginx to proxy device traffic straight to Vercel. That is
# the one configuration guaranteed NOT to work: Vercel's bot protection
# answers cloud-datacenter IPs with a JS challenge a ZKTeco terminal cannot
# solve, which is the entire reason this VM exists. Running the old script
# on a rebuilt box would leave the gym with no working access control and no
# obvious reason why.
#
# Idempotent: safe to re-run on a live box. It never overwrites .env, and it
# restarts the relay only after the new server.js passes a syntax check.
set -euo pipefail

RELAY_USER="sitedes"
RELAY_DIR="/home/${RELAY_USER}/relay-service"
RELAY_PORT="3001"
LETSENCRYPT_EMAIL="ceo_1085@levelupfitness.com.pk"

# The device-facing hostname is DERIVED FROM THE PUBLIC IP (sslip.io), and
# each terminal has it typed into its Cloud Server Setting. If a rebuilt VM
# comes up on a different IP, every device must be reconfigured BY HAND at
# its own console or it silently stops reporting. Keep the reserved static
# IP across a rebuild if at all possible.
EXPECTED_PUBLIC_IP="136.115.7.81"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ $EUID -ne 0 ]]; then echo "Run with sudo." >&2; exit 1; fi
for f in server.js package.json; do
  [[ -f "${SRC_DIR}/${f}" ]] || { echo "Missing ${SRC_DIR}/${f} — run this from a copy of the repo's relay-service/ directory." >&2; exit 1; }
done

# Refuse to install a server.js that would batch commands. A terminal
# acknowledges only the first command in a response and never re-requests
# the others, yet may still apply them — so batching both loses commands and
# corrupts our record of what each door holds. It went unnoticed for 11
# weeks. See ZKTECO_DEVICES.md section 10.
if ! grep -q "limit(COMMANDS_PER_POLL)" "${SRC_DIR}/server.js" || ! grep -qE "COMMANDS_PER_POLL\s*=\s*1\b" "${SRC_DIR}/server.js"; then
  echo "REFUSING TO INSTALL: server.js must poll with limit(COMMANDS_PER_POLL) and set COMMANDS_PER_POLL = 1." >&2
  echo "See ZKTECO_DEVICES.md section 10 before changing this." >&2
  exit 1
fi

echo "== packages =="
apt-get update
apt-get install -y nginx certbot python3-certbot-nginx curl ca-certificates gnupg
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
echo "node $(node --version)"

echo "== relay files =="
install -d -o "${RELAY_USER}" -g "${RELAY_USER}" "${RELAY_DIR}"
if [[ -f "${RELAY_DIR}/server.js" ]]; then
  cp -a "${RELAY_DIR}/server.js" "${RELAY_DIR}/server.js.bak-$(date +%F-%H%M%S)"
fi
install -o "${RELAY_USER}" -g "${RELAY_USER}" -m 0644 "${SRC_DIR}/server.js" "${RELAY_DIR}/server.js"
install -o "${RELAY_USER}" -g "${RELAY_USER}" -m 0644 "${SRC_DIR}/package.json" "${RELAY_DIR}/package.json"
node --check "${RELAY_DIR}/server.js"
sudo -u "${RELAY_USER}" bash -c "cd '${RELAY_DIR}' && npm install --omit=dev --no-audit --no-fund"

# Secrets never live in this script or in git. Created as a template on a
# fresh box; an existing .env is left strictly alone.
if [[ ! -f "${RELAY_DIR}/.env" ]]; then
  cat > "${RELAY_DIR}/.env" <<'ENVEOF'
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
PORT=3001
ENVEOF
  chown "${RELAY_USER}:${RELAY_USER}" "${RELAY_DIR}/.env"
  chmod 600 "${RELAY_DIR}/.env"
  NEEDS_ENV=1
fi

echo "== systemd =="
cat > /etc/systemd/system/zkteco-relay.service <<UNITEOF
[Unit]
Description=ZKTeco ADMS Relay Service
After=network.target

[Service]
Type=simple
WorkingDirectory=${RELAY_DIR}
ExecStart=/usr/bin/node ${RELAY_DIR}/server.js
EnvironmentFile=${RELAY_DIR}/.env
Restart=always
RestartSec=5
User=${RELAY_USER}

[Install]
WantedBy=multi-user.target
UNITEOF
systemctl daemon-reload
systemctl enable zkteco-relay

echo "== nginx =="
PUBLIC_IP="$(curl -s ifconfig.me)"
SSLIP_HOST="${PUBLIC_IP//./-}.sslip.io"
echo "public IP ${PUBLIC_IP} -> ${SSLIP_HOST}"

if [[ -n "${EXPECTED_PUBLIC_IP}" && "${PUBLIC_IP}" != "${EXPECTED_PUBLIC_IP}" ]]; then
  cat >&2 <<WARNEOF

==================================================================
*** PUBLIC IP HAS CHANGED — DEVICES WILL NOT RECONNECT ***
  was: ${EXPECTED_PUBLIC_IP}  (devices expect ${EXPECTED_PUBLIC_IP//./-}.sslip.io)
  now: ${PUBLIC_IP}           (this box will serve ${SSLIP_HOST})

The terminals have the OLD hostname typed into their Cloud Server
Setting. They will keep polling it, get nothing, and silently stop
reporting attendance and applying access changes. Nothing in the app
will show an error — the doors simply stop obeying.

Either reattach the old static IP to this VM (strongly preferred), or
walk to all three terminals and set:
    Server Address: ${SSLIP_HOST}
    Server Port:    443
    Enable HTTPS:   ON
Then update EXPECTED_PUBLIC_IP in this script.
==================================================================

WARNEOF
  read -r -p "Continue anyway? [y/N] " reply </dev/tty || reply="n"
  [[ "${reply}" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }
fi

# Proxies to the LOCAL relay, not to Vercel — the devices must never be sent
# to Vercel (see header). certbot --redirect rewrites this below into the
# same shape as the long-running production config: this block becomes a
# 301 to https, plus a TLS vhost on 443 proxying to the same place.
#
# Headers match the production config verbatim rather than being "improved".
# The one deliberate addition is client_max_body_size: production runs on
# nginx's 1MB default, which is enough for the ATTLOG and command traffic
# that matters but would reject a large /iclock/fdata face-photo upload with
# a 413. Raising the ceiling can only accept more than production does.
cat > /etc/nginx/sites-available/zkteco-relay <<NGINXEOF
server {
    listen 80 default_server;
    server_name ${SSLIP_HOST} _;

    client_max_body_size 25m;

    location / {
        proxy_pass http://127.0.0.1:${RELAY_PORT};
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    }
}
NGINXEOF
ln -sf /etc/nginx/sites-available/zkteco-relay /etc/nginx/sites-enabled/zkteco-relay
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl restart nginx

certbot --nginx -d "${SSLIP_HOST}" --non-interactive --agree-tos -m "${LETSENCRYPT_EMAIL}" --redirect || \
  echo "WARNING: certbot failed — devices need HTTPS on 443. Re-run certbot before relying on this box."
systemctl restart nginx

if [[ "${NEEDS_ENV:-0}" == "1" ]]; then
  echo
  echo "=================================================================="
  echo "ACTION REQUIRED — the relay cannot start yet."
  echo "Fill in ${RELAY_DIR}/.env (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)"
  echo "from the Vercel project's env vars, then:"
  echo "  sudo systemctl start zkteco-relay"
  echo "=================================================================="
  exit 0
fi

systemctl restart zkteco-relay
sleep 3
systemctl --no-pager status zkteco-relay | head -12

echo
echo "=================================================================="
echo "Relay provisioned. On each ZKTeco device's Cloud Server Setting:"
echo "  Server Address: ${SSLIP_HOST}"
echo "  Server Port:    443"
echo "  Enable HTTPS:   ON"
echo
echo "Confirm command delivery is NOT batched (must read 1):"
echo "  sudo journalctl -u zkteco-relay -n 30 --no-pager | grep -E 'config|Sending'"
echo "=================================================================="
