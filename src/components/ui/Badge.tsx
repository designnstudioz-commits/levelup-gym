import { cn } from "@/lib/utils";

type BadgeVariant =
  | "active"
  | "inactive"
  | "expiring"
  | "frozen"
  | "archived"
  | "pending"
  | "approved"
  | "rejected"
  | "default";

interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}

const variantClasses: Record<BadgeVariant, string> = {
  active: "bg-green-50 text-green-700 border-green-200",
  inactive: "bg-gray-100 text-gray-600 border-gray-200",
  expiring: "bg-[#FEF0E8] text-[#C04E10] border-[#FDDCC8]",
  frozen: "bg-blue-50 text-blue-700 border-blue-200",
  archived: "bg-gray-200 text-gray-500 border-gray-300",
  pending: "bg-yellow-50 text-yellow-700 border-yellow-200",
  approved: "bg-green-50 text-green-700 border-green-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
  default: "bg-gray-100 text-gray-600 border-gray-200",
};

export function Badge({ variant = "default", children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border",
        variantClasses[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
