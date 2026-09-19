import { NextResponse } from "next/server";

// DISABLED 2026-09-19 — emergency security patch.
//
// This was a second, parallel implementation of the ZKTeco ADMS device
// protocol, duplicating relay-service/server.js. The physical terminals do
// NOT use it: their Cloud Server Setting points at the relay VM
// (136-115-7-81.sslip.io), and Vercel's bot protection would challenge a
// device here anyway. A grep across src/ confirms no internal caller.
//
// It was, however, reachable by anyone on the internet: src/middleware.ts
// deliberately excludes `api/attendance` from its matcher so devices could
// reach it, and the handlers held the service-role key, which bypasses RLS.
// Confirmed live in production during the audit:
//   - getrequest returned 200 and marked pending device_commands as `sent`,
//     which would silently drain every queued door block — and nothing ever
//     retries a command marked `sent`.
//   - devicecmd allowed forging an acknowledgement for any command.
//   - push allowed inserting arbitrary attendance rows.
//
// 410 Gone rather than deletion: the /iclock/* routes re-export these, and a
// deliberate, documented tombstone is more useful to the next reader than a
// 404 from a missing file. No database client is constructed here — these
// handlers can no longer read or write anything.
// A factory, not a module-level constant: a Response body can only be read
// once, so returning one shared instance across requests can fail.
const disabled = () =>
  NextResponse.json(
    { error: "Gone. Device traffic is served by the relay service, not this app." },
    { status: 410 }
  );

export async function GET() { return disabled(); }
