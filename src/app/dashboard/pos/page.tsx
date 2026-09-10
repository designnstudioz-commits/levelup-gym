import { redirect } from "next/navigation";

/**
 * The full POS Admin Overview (active products, low stock, department
 * status — matching the approved frame) is catalogue/inventory territory
 * and belongs to Phase D, once there is real product data to summarise.
 * Building it now with placeholder figures would be worse than not having
 * it. Orders is the most complete admin view Phase C actually has, so the
 * top-level nav link lands there rather than 404ing.
 */
export default function PosOverviewPage() {
  redirect("/dashboard/pos/orders");
}
