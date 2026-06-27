import { useEffect } from "react"
import { Routes, Route, NavLink, useLocation } from "react-router-dom"
import { LayoutDashboard, Package, Cpu, BarChart2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { ThemeToggle } from "@/components/ThemeToggle"
import Dashboard from "@/pages/Dashboard"
import ShipmentDetail from "@/pages/ShipmentDetail"
import Parsers from "@/pages/Parsers"
import Stats from "@/pages/Stats"

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/parsers", label: "Parsers", icon: Cpu, exact: false },
  { to: "/stats", label: "Stats", icon: BarChart2, exact: false },
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
            ? "bg-primary/10 text-primary"
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
        <aside className="hidden md:flex flex-col w-56 shrink-0 border-r border-border bg-card">
          <div className="flex items-center justify-between px-4 py-4 border-b border-border">
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" />
              <span className="font-bold text-lg tracking-tight">Trackbox</span>
            </div>
          </div>
          <nav className="flex-1 p-3 space-y-1">
            {NAV_ITEMS.map(item => (
              <NavItem key={item.to} {...item} />
            ))}
          </nav>
          <div className="p-3 border-t border-border flex justify-end">
            <ThemeToggle />
          </div>
        </aside>

        {/* Main content */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Mobile header */}
          <header className="md:hidden flex items-center justify-between px-4 py-3 border-b border-border bg-card">
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" />
              <span className="font-bold tracking-tight">Trackbox</span>
            </div>
            <ThemeToggle />
          </header>

          <main className="flex-1 overflow-auto pb-16 md:pb-0">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/shipments/:id" element={<ShipmentDetail />} />
              <Route path="/parsers" element={<Parsers />} />
              <Route path="/stats" element={<Stats />} />
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
