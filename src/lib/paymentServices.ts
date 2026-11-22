/**
 * Collecting a fee against a specific service (sauna, jacuzzi, MMA…) rather
 * than only the six accounting categories.
 *
 * Shared because there are two "record a fee payment" modals — the Fees page
 * and the member profile — and they have to agree. A service encoded one way
 * in one and another way in the other would file the same sale under two
 * different categories.
 */

/** A service picked in a Payment Type dropdown is encoded as
 *  "svc:<package id>". Prefixed so it can never collide with one of the six
 *  payment_type values, which share the same <select>. */
export const SERVICE_PREFIX = "svc:";

export interface ServiceOption {
  id: string;
  name: string;
  monthly_fee: number | null;
}

export function isServiceValue(v: string): boolean {
  return v.startsWith(SERVICE_PREFIX);
}

export function servicePackageId(v: string): string {
  return v.slice(SERVICE_PREFIX.length);
}

/**
 * Which accounting category a service payment is filed under.
 *
 * payment_type drives revenue reports, fee status and trainer commission, so
 * a sauna session must not land in "membership". Anything without an obvious
 * home goes to "other": that keeps service income visible and separate
 * rather than inflating a total the owner reads as recurring membership
 * revenue. The service itself is recorded alongside, so "Other" is never
 * where the detail goes to die — the revenue breakdown splits it back out by
 * service name.
 */
export function categoryForService(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("personal training") || n.includes(" pt")) return "trainer";
  if (n.includes("nutritionist")) return "nutritionist";
  if (n.includes("physiotherapy")) return "physiotherapy";
  return "other";
}

/** Resolves a dropdown value into the three things a fee_payments row needs. */
export function resolvePaymentType(
  value: string,
  servicesById: Record<string, ServiceOption>
): { payment_type: string; service_package_id: string | null; service_name: string | null } {
  if (!isServiceValue(value)) {
    return { payment_type: value, service_package_id: null, service_name: null };
  }
  const svc = servicesById[servicePackageId(value)];
  if (!svc) {
    // The package vanished between loading the form and submitting it.
    // Recording the money as uncategorised beats refusing the payment.
    return { payment_type: "other", service_package_id: null, service_name: null };
  }
  return {
    payment_type: categoryForService(svc.name),
    service_package_id: svc.id,
    service_name: svc.name,
  };
}
