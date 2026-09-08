"use client";

import { Package } from "lucide-react";
import { cn, formatPKR } from "@/lib/utils";
import { hasMemberPricing } from "@/lib/pos/pricing";
import type { TerminalProduct } from "@/lib/pos/catalog";

/**
 * One tappable product.
 *
 * Sizing per the Phase 3 spec: the tile is at least 180x150, well above the
 * 44px WCAG 2.5.5 floor, because the operator is working at speed and often
 * one-handed.
 *
 * Badges follow the approved frame — Member, Low, Sold out — using the
 * existing Badge palette values rather than the Figma's green.
 */
export function ProductTile({
  product,
  memberAttached,
  onSelect,
}: {
  product: TerminalProduct;
  memberAttached: boolean;
  onSelect: (p: TerminalProduct) => void;
}) {
  const soldOut = !product.is_available;
  const lowStock =
    product.track_inventory &&
    product.low_stock_threshold != null &&
    product.stock_qty <= product.low_stock_threshold &&
    product.stock_qty > 0;
  const outOfStock = product.track_inventory && product.stock_qty <= 0;

  // Unavailable is a catalogue state; out-of-stock is an inventory state.
  // Both block a sale, so they render the same way but say different things.
  const blocked = soldOut || outOfStock;

  const memberDeal = hasMemberPricing(product);
  const hasOptions = product.modifierGroups.length > 0 || product.variants.length > 0;

  return (
    <button
      type="button"
      disabled={blocked}
      onClick={() => onSelect(product)}
      className={cn(
        "group relative text-left rounded-xl border bg-white overflow-hidden",
        "min-h-[186px] flex flex-col cursor-pointer",
        "transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F06418] focus-visible:ring-offset-2",
        blocked
          ? "border-[#E4E4DE] opacity-55 cursor-not-allowed"
          : "border-[#E4E4DE] hover:border-[#F06418] active:scale-[0.98]"
      )}
    >
      <div className="h-[92px] bg-[#F7F6F3] flex items-center justify-center flex-shrink-0 border-b border-[#E4E4DE]">
        {product.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.image_url}
            alt=""
            className="w-full h-full object-cover"
          />
        ) : (
          <Package className="w-7 h-7 text-[#CFCEC6]" />
        )}
      </div>

      <div className="flex-1 p-3 flex flex-col">
        <p className="text-[15px] font-semibold text-[#1A1A16] leading-tight line-clamp-2">
          {product.name}
        </p>
        {product.description && (
          <p className="text-xs text-[#7A7A72] mt-0.5 line-clamp-1">{product.description}</p>
        )}

        <div className="mt-auto pt-2 flex items-end justify-between gap-2">
          <span className="text-lg font-bold text-[#1A1A16] font-[family-name:var(--font-barlow-condensed)] tabular-nums">
            {formatPKR(product.selling_price)}
          </span>

          <div className="flex flex-wrap gap-1 justify-end">
            {blocked && (
              <Tag className="bg-gray-100 text-gray-600 border-gray-200">
                {outOfStock && !soldOut ? "Out of stock" : "Sold out"}
              </Tag>
            )}
            {!blocked && lowStock && (
              <Tag className="bg-amber-50 text-amber-700 border-amber-200">Low</Tag>
            )}
            {!blocked && memberDeal && (
              <Tag
                className={cn(
                  "border",
                  memberAttached
                    ? "bg-[#FEF0E8] text-[#C04E10] border-[#FDDCC8]"
                    : "bg-green-50 text-green-700 border-green-200"
                )}
              >
                Member
              </Tag>
            )}
          </div>
        </div>
      </div>

      {/* Signals that tapping opens the Customize sheet rather than adding
          straight to the cart — otherwise a required choice feels like a
          missed tap. */}
      {hasOptions && !blocked && (
        <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded-md bg-white/90 border border-[#E4E4DE] text-[10px] font-semibold text-[#4A4A44]">
          Options
        </span>
      )}
    </button>
  );
}

function Tag({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border whitespace-nowrap",
        className
      )}
    >
      {children}
    </span>
  );
}
