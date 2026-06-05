import { type LucideIcon } from "lucide-react";

interface ComingSoonProps {
  title: string;
  icon: LucideIcon;
  description: string;
  phase?: string;
}

export function ComingSoon({ title, icon: Icon, description, phase = "Phase 2" }: ComingSoonProps) {
  return (
    <div className="flex flex-col items-center justify-center flex-1 py-24 px-4 text-center">
      <div className="w-16 h-16 bg-[#FEF0E8] rounded-2xl flex items-center justify-center mb-5">
        <Icon className="w-8 h-8 text-[#F06418]" />
      </div>
      <h2 className="text-xl font-bold text-[#1A1A16] mb-2 font-[family-name:var(--font-barlow-condensed)] uppercase">
        {title}
      </h2>
      <p className="text-[#7A7A72] text-sm max-w-sm">{description}</p>
      <span className="mt-4 inline-flex items-center px-3 py-1 bg-[#F8F8F6] border border-[#E4E4DE] rounded-full text-xs font-medium text-[#4A4A44]">
        Coming in {phase}
      </span>
    </div>
  );
}
