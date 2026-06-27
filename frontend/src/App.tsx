import { useEffect } from "react"
import { Routes, Route, NavLink, useLocation } from "react-router-dom"
import { LayoutDashboard, Cpu, BarChart2, Settings as SettingsIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { ThemeToggle } from "@/components/ThemeToggle"
import Dashboard from "@/pages/Dashboard"
import ShipmentDetail from "@/pages/ShipmentDetail"
import Parsers from "@/pages/Parsers"
import Stats from "@/pages/Stats"
import Settings from "@/pages/Settings"

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/parsers", label: "Parsers", icon: Cpu, exact: false },
  { to: "/stats", label: "Stats", icon: BarChart2, exact: false },
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
        {/* Sidebar — desktop (item 9: branding upgrade) */}
        <aside className="hidden md:flex flex-col w-56 shrink-0 border-r border-border bg-[#F1F5F9] dark:bg-[hsl(222,25%,9%)]">
          {/* Wordmark */}
          <div className="flex items-center justify-between px-4 py-4 border-b border-border">
            <div className="flex items-center gap-2.5">
              {/* Brand mark: box outline with route nodes */}
              <svg
                width="22"
                height="22"
                viewBox="0 0 22 22"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden
                className="shrink-0"
              >
                {/* Box outline */}
                <rect x="3" y="5" width="16" height="14" rx="1.5" stroke="#2563EB" strokeWidth="1.75" />
                {/* Route nodes */}
                <circle cx="8" cy="12" r="1.5" fill="#2563EB" />
                <circle cx="14" cy="12" r="1.5" fill="#2563EB" />
                {/* Connection line */}
                <line x1="9.5" y1="12" x2="12.5" y2="12" stroke="#2563EB" strokeWidth="1.25" strokeLinecap="round" />
                {/* Top fold line */}
                <line x1="3" y1="9" x2="19" y2="9" stroke="#2563EB" strokeWidth="1.25" />
              </svg>
              <span className="font-bold text-[15px] tracking-tight text-foreground">trackbox</span>
            </div>
          </div>
          <nav className="flex-1 p-3 space-y-0.5">
            {NAV_ITEMS.map(item => (
              <NavItem key={item.to} {...item} />
            ))}
          </nav>
          <div className="p-3 border-t border-border flex justify-end">
            <ThemeToggle />
          </div>
          <div className="hidden md:block px-4 pb-3 text-[10px] text-muted-foreground/60 leading-relaxed">
            Icons by{" "}
            <a href="https://50north.de" target="_blank" rel="noopener noreferrer" className="underline hover:text-muted-foreground">50north.de</a>
            {", "}
            <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer" className="underline hover:text-muted-foreground">CC BY 4.0</a>
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
              <Route path="/shipments/:id" element={<ShipmentDetail />} />
              <Route path="/parsers" element={<Parsers />} />
              <Route path="/stats" element={<Stats />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </main>
        </div>
      </div>

      {/* Bottom nav — mobile (hidden on detail page to avoid clutter) */}
      {!isDetail && (
        <nav className="md:hidden fixed bottom-0 inset-x-0 border-t border-border bg-card flex justify-around z-50">
          {NAV_ITEMS.map(item => (
            <MobileNavItem key={item.to} {...item} />
          ))}
        </nav>
      )}
    </>
  )
}
