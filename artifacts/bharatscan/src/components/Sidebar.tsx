import { NavLink } from "react-router-dom";
import {
  Home,
  LayoutDashboard,
  ScanSearch,
  TrendingUp,
  Briefcase,
  BookMarked,
  Bell,
  Settings,
  LineChart,
  Wallet,
  Plug,
} from "lucide-react";
import logoUrl from "@/assets/bharatscan-logo.png";
import { useTheme } from "@/hooks/useTheme";

const NAV_ITEMS = [
  { to: "/home", label: "Home", icon: Home },
  { to: "/scanner-dashboard", label: "Scanner\nDashboard", icon: LayoutDashboard },
  { to: "/create-scan", label: "Create\nScan", icon: ScanSearch },
  { to: "/options", label: "Options\nAnalysis", icon: LineChart },
  { to: "/strategies-backtest", label: "Strategies\nBacktest", icon: TrendingUp },
  { to: "/portfolio", label: "Portfolio", icon: Briefcase },
  { to: "/paper-trading", label: "Paper\nTrading", icon: Wallet },
  { to: "/saved-scan", label: "Saved\nScan", icon: BookMarked },
  { to: "/alerts", label: "Alerts", icon: Bell },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const { theme } = useTheme();

  return (
    <aside className="fixed left-0 top-0 bottom-0 w-14 z-50 flex flex-col bg-card border-r border-border shadow-lg">
      {/* Logo */}
      <div className="flex items-center justify-center h-14 border-b border-border shrink-0">
        <img
          src={logoUrl}
          alt="BharatScan"
          className={`h-7 w-7 object-contain transition-[filter] duration-300 ${
            theme === "light"
              ? "[filter:invert(1)_drop-shadow(0_0_4px_rgba(96,165,250,0.3))]"
              : "[filter:drop-shadow(0_0_4px_rgba(96,165,250,0.2))]"
          }`}
        />
      </div>

      {/* Nav items */}
      <nav className="flex flex-col items-center gap-0.5 py-2 flex-1 overflow-y-auto overflow-x-hidden">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end
            className={({ isActive }) =>
              `group relative flex flex-col items-center justify-center w-12 py-2 rounded-lg mx-1 transition-all duration-150 cursor-pointer select-none ${
                isActive
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  className={`h-4.5 w-4.5 shrink-0 transition-colors ${
                    isActive ? "text-primary" : "text-current"
                  }`}
                  size={18}
                />
                <span className="text-[9px] font-medium leading-tight text-center mt-0.5 whitespace-pre-line">
                  {label}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Bottom brand */}
      <div className="pb-2 flex items-center justify-center">
        <span className="text-[8px] text-muted-foreground/50 font-semibold tracking-widest rotate-0">BS</span>
      </div>
    </aside>
  );
}
