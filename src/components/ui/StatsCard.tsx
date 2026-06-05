import { cn } from "@/lib/utils";
import { type LucideIcon, TrendingUp, TrendingDown } from "lucide-react";

interface StatsCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  iconColor?: string;
  iconBg?: string;
  trend?: { value: number; label: string };
  className?: string;
  loading?: boolean;
}

export function StatsCard({
  title,
  value,
  icon: Icon,
  iconColor = "text-[#F06418]",
  iconBg = "bg-[#FEF0E8]",
  trend,
  className,
  loading,
}: StatsCardProps) {
  return (
    <div
      className={cn(
        "bg-white border border-[#E4E4DE] rounded-xl p-5 flex items-start gap-4",
        className
      )}
    >
      <div className={cn("p-2.5 rounded-lg flex-shrink-0", iconBg)}>
        <Icon className={cn("w-5 h-5", iconColor)} strokeWidth={2} />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm text-[#7A7A72] font-medium">{title}</p>
        {loading ? (
          <div className="h-7 w-20 bg-gray-100 animate-pulse rounded mt-1" />
        ) : (
          <p className="text-2xl font-bold text-[#1A1A16] mt-0.5 font-[family-name:var(--font-barlow-condensed)]">
            {value}
          </p>
        )}
        {trend && !loading && (
          <div
            className={cn(
              "flex items-center gap-1 mt-1 text-xs font-medium",
              trend.value >= 0 ? "text-green-600" : "text-red-600"
            )}
          >
            {trend.value >= 0 ? (
              <TrendingUp className="w-3 h-3" />
            ) : (
              <TrendingDown className="w-3 h-3" />
            )}
            <span>{Math.abs(trend.value)}% {trend.label}</span>
          </div>
        )}
      </div>
    </div>
  );
}
