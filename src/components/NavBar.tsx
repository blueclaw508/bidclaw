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
  { value: "production-rates", label: "My Production Rates", icon: Gauge },
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
    <header className="sticky top-0 z-50 w-full bg-white border-b border-gray-200">
      <div className="mx-auto flex h-14 max-w-screen-2xl items-center justify-between px-4">
        {/* Left: Logo */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#2563EB] text-white text-xs font-bold">
            BC
          </div>
          <span className="text-lg font-semibold text-gray-900 hidden sm:inline">
            BidClaw
          </span>
        </div>

        {/* Center: Desktop tabs */}
        <nav className="hidden md:flex items-center gap-1 mx-4">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = currentTab === tab.value;
            return (
              <button
                key={tab.value}
                onClick={() => handleTabChange(tab.value)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-[#2563EB]/10 text-[#2563EB]"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}

          {/* Estimates tab — visually distinct */}
          <button
            onClick={() => handleTabChange("estimates")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ml-1 ${
              currentTab === "estimates"
                ? "bg-[#2563EB] text-white shadow-sm"
                : "bg-[#2563EB]/90 text-white hover:bg-[#2563EB] shadow-sm"
            }`}
          >
            <ClipboardList className="h-4 w-4" />
            <span>Estimates</span>
          </button>
        </nav>

        {/* Right: Avatar / user dropdown */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative">
            <button
              onClick={() => setAvatarMenuOpen((prev) => !prev)}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-200 text-gray-600">
                <User className="h-4 w-4" />
              </div>
              <span className="hidden lg:inline max-w-[160px] truncate text-sm text-gray-600">
                {user?.email ?? "Account"}
              </span>
              <ChevronDown className="h-3.5 w-3.5 text-gray-400 hidden lg:block" />
            </button>

            {avatarMenuOpen && (
              <>
                {/* Backdrop to close menu */}
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setAvatarMenuOpen(false)}
                />
                <div className="absolute right-0 top-full mt-1 z-50 w-56 rounded-md border border-gray-200 bg-white py-1 shadow-lg">
                  {user?.email && (
                    <div className="px-3 py-2 text-xs text-gray-500 border-b border-gray-100 truncate">
                      {user.email}
                    </div>
                  )}
                  <button
                    onClick={() => {
                      setAvatarMenuOpen(false);
                      signOut();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
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
            className="md:hidden flex items-center justify-center h-8 w-8 rounded-md text-gray-600 hover:bg-gray-100"
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? (
              <X className="h-5 w-5" />
            ) : (
              <Menu className="h-5 w-5" />
            )}
          </button>
        </div>
      </div>

      {/* Mobile menu dropdown */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-gray-200 bg-white px-4 pb-3 pt-2 shadow-lg">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = currentTab === tab.value;
            return (
              <button
                key={tab.value}
                onClick={() => handleTabChange(tab.value)}
                className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-[#2563EB]/10 text-[#2563EB]"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
          <button
            onClick={() => handleTabChange("estimates")}
            className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors mt-1 ${
              currentTab === "estimates"
                ? "bg-[#2563EB] text-white"
                : "bg-[#2563EB]/90 text-white"
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
