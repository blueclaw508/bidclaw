import { X } from "lucide-react";

interface UpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function UpgradeModal({ isOpen, onClose }: UpgradeModalProps) {
  if (!isOpen) return null;

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
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-[#2563EB] text-white text-xl font-bold mb-5">
            BC
          </div>

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

          {/* CTA */}
          <a
            href="#upgrade"
            className="inline-flex w-full max-w-xs items-center justify-center rounded-lg bg-[#2563EB] px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-[#1d4ed8] transition-colors focus:outline-none focus:ring-2 focus:ring-[#2563EB]/50 focus:ring-offset-2"
          >
            Upgrade Now &mdash; $599/mo
          </a>

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
