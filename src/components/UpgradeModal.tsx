import { useState } from "react";
import { X, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

interface UpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function UpgradeModal({ isOpen, onClose }: UpgradeModalProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleUpgrade = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/.netlify/functions/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_email: user?.email,
          user_id: user?.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Checkout failed");
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal card */}
      <div className="relative z-10 w-full max-w-lg mx-4 rounded-xl bg-white shadow-2xl">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex flex-col items-center px-8 py-10 text-center">
          {/* Logo */}
          <img src="/bidclaw-logo.png" alt="BidClaw" className="h-14 w-14 rounded-xl object-contain mb-5" />

          {/* Headline */}
          <h2 className="text-2xl font-bold text-gray-900 mb-3">
            BidClaw Requires an Upgrade
          </h2>

          {/* Body */}
          <p className="text-sm leading-relaxed text-gray-600 mb-2 max-w-sm">
            BidClaw is an advanced estimating add-on for QuickCalc Pro
            subscribers. Upgrading replaces your current{" "}
            <span className="font-medium text-gray-800">$39/mo Pro</span> plan
            with the all-inclusive{" "}
            <span className="font-medium text-gray-800">
              BidClaw plan at $599/mo
            </span>
            .
          </p>
          <p className="text-sm leading-relaxed text-gray-600 mb-8 max-w-sm">
            Your BidClaw subscription includes full access to every QuickCalc
            Pro feature plus powerful bid-management tools — production rates,
            item catalogs, multi-line-item estimates, and more.
          </p>

          {error && (
            <p className="mb-4 text-sm text-red-600">{error}</p>
          )}

          {/* CTA */}
          <button
            onClick={handleUpgrade}
            disabled={loading}
            className="inline-flex w-full max-w-xs items-center justify-center gap-2 rounded-lg bg-[#2563EB] px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-[#1d4ed8] transition-colors focus:outline-none focus:ring-2 focus:ring-[#2563EB]/50 focus:ring-offset-2 disabled:opacity-60"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {loading ? "Redirecting to Stripe…" : "Upgrade Now — $599/mo"}
          </button>

          {/* Secondary link */}
          <a
            href="https://bluequickcalc.app"
            className="mt-4 text-sm text-gray-500 hover:text-gray-700 underline underline-offset-2 transition-colors"
          >
            Return to QuickCalc
          </a>
        </div>
      </div>
    </div>
  );
}
