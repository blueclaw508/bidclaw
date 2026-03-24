import { useState } from "react";
import {
  Building2,
  BookOpen,
  Gauge,
  Info,
  ClipboardList,
  Menu,
  X,
  ChevronDown,
  LogOut,
  User,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

type TabValue =
  | "company-info"
  | "item-catalog"
  | "production-rates"
  | "about-kyn"
  | "estimates";

interface NavBarProps {
  currentTab: string;
  onTabChange: (tab: TabValue) => void;
}

const tabs: { value: TabValue; label: string; icon: React.ElementType }[] = [
  { value: "company-info", label: "Company Info", icon: Building2 },
  { value: "item-catalog", label: "Item Catalog", icon: BookOpen },
  { value: "production-rates", label: "Production Rates", icon: Gauge },
  { value: "about-kyn", label: "About KYN", icon: Info },
];

export default function NavBar({ currentTab, onTabChange }: NavBarProps) {
  const { user, signOut } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);

  const handleTabChange = (tab: TabValue) => {
    onTabChange(tab);
    setMobileMenuOpen(false);
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-[#0c1428]/20 bg-gradient-to-r from-[#0c1428] via-[#1e3a8a] to-[#0c1428] shadow-md">
      <div className="mx-auto flex h-20 max-w-screen-2xl items-center justify-between px-4">
        {/* Left: Logo */}
        <div className="flex items-center gap-3 shrink-0">
          <img src="/bidclaw-logo-sm.png" alt="BidClaw" className="h-14 w-14 rounded object-contain" />
          <span className="text-2xl font-bold text-white hidden sm:inline tracking-tight">
            BidClaw
          </span>
        </div>

        {/* Center: Desktop tabs */}
        <nav className="hidden md:flex items-center gap-0.5 mx-4">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = currentTab === tab.value;
            return (
              <button
                key={tab.value}
                onClick={() => handleTabChange(tab.value)}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  isActive
                    ? "bg-white/20 text-white shadow-sm"
                    : "text-blue-200 hover:bg-white/10 hover:text-white"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}

          {/* Estimates tab — visually distinct */}
          <button
            onClick={() => handleTabChange("estimates")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ml-1 ${
              currentTab === "estimates"
                ? "bg-white text-[#1e40af] shadow-sm"
                : "bg-white/90 text-[#1e40af] hover:bg-white shadow-sm"
            }`}
          >
            <ClipboardList className="h-3.5 w-3.5" />
            <span>Estimates</span>
          </button>
        </nav>

        {/* Right: Avatar / user dropdown */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative">
            <button
              onClick={() => setAvatarMenuOpen((prev) => !prev)}
              className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-blue-200 hover:bg-white/10 hover:text-white transition-colors"
            >
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white/20 text-white">
                <User className="h-3.5 w-3.5" />
              </div>
              <span className="hidden lg:inline max-w-[140px] truncate text-xs text-blue-100">
                {user?.email ?? "Account"}
              </span>
              <ChevronDown className="h-3 w-3 text-blue-300 hidden lg:block" />
            </button>

            {avatarMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setAvatarMenuOpen(false)}
                />
                <div className="absolute right-0 top-full mt-1 z-50 w-52 rounded-md border border-slate-200 bg-white py-1 shadow-lg">
                  {user?.email && (
                    <div className="px-3 py-2 text-xs text-slate-500 border-b border-slate-100 truncate">
                      {user.email}
                    </div>
                  )}
                  <button
                    onClick={() => {
                      setAvatarMenuOpen(false);
                      signOut();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <LogOut className="h-4 w-4" />
                    Sign Out
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            className="md:hidden flex items-center justify-center h-7 w-7 rounded-md text-blue-200 hover:bg-white/10 hover:text-white"
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? (
              <X className="h-4 w-4" />
            ) : (
              <Menu className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {/* Mobile menu dropdown */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-white/10 bg-[#0c1428] px-4 pb-3 pt-2">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = currentTab === tab.value;
            return (
              <button
                key={tab.value}
                onClick={() => handleTabChange(tab.value)}
                className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-white/20 text-white"
                    : "text-blue-200 hover:bg-white/10 hover:text-white"
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
          <button
            onClick={() => handleTabChange("estimates")}
            className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition-colors mt-1 ${
              currentTab === "estimates"
                ? "bg-white text-[#1e40af]"
                : "bg-white/90 text-[#1e40af]"
            }`}
          >
            <ClipboardList className="h-4 w-4" />
            Estimates
          </button>
        </div>
      )}
    </header>
  );
}
