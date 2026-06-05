
import { RegistrationForm } from "@/components/forms/registration";

export const metadata = {
  title: "Member Registration — Level Up Fitness Club",
  description: "Register for membership at Level Up Fitness Club, Paragon City Lahore.",
};

export default function RegisterPage() {
  return (
    <div className="min-h-screen bg-[#F8F8F6]">
      {/* Header */}
      <header className="bg-[#111111] px-4 py-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <img
            src="/logo.png"
            alt="Level Up Fitness Club"
            className="h-10 w-auto object-contain"
          />
          <span className="text-xs font-semibold text-[#F06418] bg-[#F06418]/10 px-2.5 py-1 rounded-full border border-[#F06418]/30">
            Member Registration
          </span>
        </div>
      </header>

      {/* Form */}
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="bg-white rounded-2xl border border-[#E4E4DE] p-6 sm:p-8">
          <div className="mb-6">
            <h1
              className="text-2xl font-bold text-[#1A1A16] uppercase"
              style={{ fontFamily: "var(--font-barlow-condensed)" }}
            >
              New Member Registration
            </h1>
            <p className="text-sm text-[#7A7A72] mt-1">
              Fill in all required fields to submit your membership application.
            </p>
          </div>
          <RegistrationForm mode="public" />
        </div>
      </div>
    </div>
  );
}
