import { redirect } from "next/navigation";

/** Safety net for a bare /catalog link — the sidebar and every internal
 *  link already point at /catalog/products directly. */
export default function PosCatalogPage() {
  redirect("/dashboard/pos/catalog/products");
}
