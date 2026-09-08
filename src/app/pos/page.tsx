import { createClient } from "@/lib/supabase/server";
import { loadTerminalCatalog } from "@/lib/pos/catalog";
import { PosTerminal } from "@/components/pos/PosTerminal";

/**
 * The cashier terminal route.
 *
 * A server component so the catalogue is loaded and cost-stripped before
 * anything reaches the browser — loadTerminalCatalog never selects
 * cost_price, so margin cannot be serialised into the client bundle by
 * accident. Role enforcement already happened in the layout.
 *
 * force-dynamic because availability, stock and prices change during a
 * shift; a cached catalogue would let a cashier sell something marked sold
 * out minutes earlier.
 */
export const dynamic = "force-dynamic";

export default async function PosTerminalPage() {
  const supabase = await createClient();
  const catalog = await loadTerminalCatalog(supabase);

  return <PosTerminal catalog={catalog} />;
}
