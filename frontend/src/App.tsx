import { useEffect } from "react"
import { Routes, Route, NavLink, useLocation } from "react-router-dom"
import {
  LayoutDashboard, Package, Truck, Bell, Zap, Code2,
  Settings as SettingsIcon, Cpu, BarChart2,
  BookOpen, HelpCircle, ScrollText, ChevronDown,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { ThemeToggle } from "@/components/ThemeToggle"
import Dashboard from "@/pages/Dashboard"
import Shipments from "@/pages/Shipments"
import ShipmentDetail from "@/pages/ShipmentDetail"
import Parsers from "@/pages/Parsers"
import Stats from "@/pages/Stats"
import Settings from "@/pages/Settings"

const PRIMARY_NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/shipments", label: "Shipments", icon: Package, exact: true },
  { to: "/carriers", label: "Carriers", icon: Truck, exact: false },
  { to: "/notifications", label: "Notifications", icon: Bell, exact: false },
  { to: "/automations", label: "Automations", icon: Zap, exact: false },
  { to: "/api", label: "API", icon: Code2, exact: false },
  { to: "/settings", label: "Settings", icon: SettingsIcon, exact: false },
]

const TOOL_NAV = [
  { to: "/parsers", label: "Parsers", icon: Cpu, exact: false },
  { to: "/stats", label: "Stats", icon: BarChart2, exact: false },
]

// ponytail: mobile nav shows the 4 most used items only
const MOBILE_NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/shipments", label: "Shipments", icon: Package, exact: true },
  { to: "/parsers", label: "Parsers", icon: Cpu, exact: false },
  { to: "/settings", label: "Settings", icon: SettingsIcon, exact: false },
]

function NavItem({ to, label, icon: Icon, exact }: { to: string; label: string; icon: typeof LayoutDashboard; exact: boolean }) {
  return (
    <NavLink
      to={to}
      end={exact}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
          isActive
            ? "bg-primary text-primary-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground hover:bg-accent"
        )
      }
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span>{label}</span>
    </NavLink>
  )
}

function MobileNavItem({ to, label, icon: Icon, exact }: { to: string; label: string; icon: typeof LayoutDashboard; exact: boolean }) {
  return (
    <NavLink
      to={to}
      end={exact}
      className={({ isActive }) =>
        cn(
          "flex flex-col items-center gap-1 px-3 py-2 text-xs font-medium transition-colors",
          isActive ? "text-primary" : "text-muted-foreground"
        )
      }
    >
      <Icon className="h-5 w-5" />
      <span>{label}</span>
    </NavLink>
  )
}

// Apply stored theme on mount
function ThemeApplier() {
  useEffect(() => {
    const stored = localStorage.getItem("theme")
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches
    if (stored === "dark" || (!stored && prefersDark)) {
      document.documentElement.classList.add("dark")
    }
  }, [])
  return null
}

export default function App() {
  const location = useLocation()
  const isDetail = location.pathname.startsWith("/shipments/")

  return (
    <>
      <ThemeApplier />
      <div className="min-h-screen flex bg-background">
        {/* Sidebar — desktop */}
        <aside className="hidden md:flex flex-col w-56 shrink-0 border-r border-border bg-[#F1F5F9] dark:bg-[hsl(222,25%,9%)]">
          {/* Wordmark */}
          <div className="flex items-center px-4 py-4 border-b border-border">
            <div className="flex items-center gap-2.5">
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden className="shrink-0">
                <rect x="3" y="5" width="16" height="14" rx="1.5" stroke="#2563EB" strokeWidth="1.75" />
                <circle cx="8" cy="12" r="1.5" fill="#2563EB" />
                <circle cx="14" cy="12" r="1.5" fill="#2563EB" />
                <line x1="9.5" y1="12" x2="12.5" y2="12" stroke="#2563EB" strokeWidth="1.25" strokeLinecap="round" />
                <line x1="3" y1="9" x2="19" y2="9" stroke="#2563EB" strokeWidth="1.25" />
              </svg>
              <span className="font-bold text-[15px] tracking-tight text-foreground">trackbox</span>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 p-3 flex flex-col gap-0.5 overflow-y-auto">
            {/* Primary items */}
            {PRIMARY_NAV.map(item => (
              <NavItem key={item.to} {...item} />
            ))}

            {/* Separator + tool items */}
            <div className="py-1"><div className="border-t border-border" /></div>
            {TOOL_NAV.map(item => (
              <NavItem key={item.to} {...item} />
            ))}

            {/* Spacer pushes help links to bottom */}
            <div className="flex-1" />

            {/* Help links */}
            <div className="py-1"><div className="border-t border-border" /></div>
            {[
              { label: "Documentation", icon: BookOpen },
              { label: "Support", icon: HelpCircle },
              { label: "Changelog", icon: ScrollText },
            ].map(({ label, icon: Icon }) => (
              <a key={label} href="#" className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                <Icon className="h-4 w-4 shrink-0" />
                <span>{label}</span>
              </a>
            ))}
          </nav>

          {/* User profile + theme toggle */}
          <div className="border-t border-border p-3">
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent cursor-default">
              <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-[11px] font-bold shrink-0">BA</div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold leading-tight truncate">Bastian Stahmer</div>
                <div className="text-[10px] text-muted-foreground">Administrator</div>
              </div>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <ThemeToggle />
            </div>
            <div className="mt-1 text-[9px] text-muted-foreground/50 px-2 leading-relaxed">
              Icons by{" "}
              <a href="https://50north.de" target="_blank" rel="noopener noreferrer" className="underline hover:text-muted-foreground">50north.de</a>
              {", "}
              <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer" className="underline hover:text-muted-foreground">CC BY 4.0</a>
            </div>
          </div>
        </aside>

        {/* Main content */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Mobile header */}
          <header className="md:hidden flex items-center justify-between px-4 py-3 border-b border-border bg-card">
            <div className="flex items-center gap-2">
              <svg width="20" height="20" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden className="shrink-0">
                <rect x="3" y="5" width="16" height="14" rx="1.5" stroke="#2563EB" strokeWidth="1.75" />
                <circle cx="8" cy="12" r="1.5" fill="#2563EB" />
                <circle cx="14" cy="12" r="1.5" fill="#2563EB" />
                <line x1="9.5" y1="12" x2="12.5" y2="12" stroke="#2563EB" strokeWidth="1.25" strokeLinecap="round" />
                <line x1="3" y1="9" x2="19" y2="9" stroke="#2563EB" strokeWidth="1.25" />
              </svg>
              <span className="font-bold tracking-tight text-foreground">trackbox</span>
            </div>
            <ThemeToggle />
          </header>

          <main className="flex-1 overflow-auto pb-16 md:pb-0">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/shipments" element={<Shipments />} />
              <Route path="/shipments/:id" element={<ShipmentDetail />} />
              <Route path="/parsers" element={<Parsers />} />
              <Route path="/stats" element={<Stats />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<div className="flex items-center justify-center h-64 text-muted-foreground text-sm">Coming soon</div>} />
            </Routes>
          </main>
        </div>
      </div>

      {/* Bottom nav — mobile (hidden on detail page to avoid clutter) */}
      {!isDetail && (
        <nav className="md:hidden fixed bottom-0 inset-x-0 border-t border-border bg-card flex justify-around z-50">
          {MOBILE_NAV.map(item => (
            <MobileNavItem key={item.to} {...item} />
          ))}
        </nav>
      )}
    </>
  )
}
