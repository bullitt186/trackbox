import { useEffect, useState } from "react"
import { Package, PackageCheck, Cpu, Activity, TrendingUp, AlertTriangle, Server } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { fetchShipments, fetchParsers, fetchHealth } from "@/lib/api"
import type { Shipment } from "@/lib/api"
import { STATE_LABELS, cn } from "@/lib/utils"

interface HealthData {
  status: string
  version: string
  build_time: string
  uptime_seconds: number
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
}: {
  icon: typeof Package
  label: string
  value: string | number
  sub?: string
  color?: string
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className={cn("text-3xl font-bold mt-1 tabular-nums", color)}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </div>
          <div className="p-2 rounded-lg bg-primary/10">
            <Icon className="h-5 w-5 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

interface BarChartProps {
  data: { label: string; value: number; color: string }[]
  total: number
  title: string
}

function BarChart({ data, total, title }: BarChartProps) {
  const filtered = data.filter(d => d.value > 0)
  if (filtered.length === 0) return null

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2.5">
          {filtered.map(item => {
            const pct = total > 0 ? Math.round((item.value / total) * 100) : 0
            return (
              <div key={item.label}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm">{item.label}</span>
                  <span className="text-sm font-semibold tabular-nums">
                    {item.value} <span className="text-muted-foreground font-normal">({pct}%)</span>
                  </span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className={cn("h-full rounded-full transition-all", item.color)}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

const STATE_COLORS: Record<string, string> = {
  delivered: "bg-emerald-500",
  in_transit: "bg-blue-500",
  shipped: "bg-blue-400",
  out_for_delivery: "bg-amber-500",
  delayed: "bg-red-500",
  exception: "bg-red-600",
  preparing: "bg-slate-400",
  unknown: "bg-slate-300",
}

function carrierColor(idx: number): string {
  const colors = [
    "bg-violet-500",
    "bg-sky-500",
    "bg-teal-500",
    "bg-orange-500",
    "bg-pink-500",
    "bg-indigo-500",
    "bg-lime-500",
    "bg-cyan-500",
  ]
  return colors[idx % colors.length]
}

export default function Stats() {
  const [activeShipments, setActiveShipments] = useState<Shipment[]>([])
  const [deliveredShipments, setDeliveredShipments] = useState<Shipment[]>([])
  const [archivedShipments, setArchivedShipments] = useState<Shipment[]>([])
  const [parserCount, setParserCount] = useState(0)
  const [health, setHealth] = useState<HealthData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetchShipments("active"),
      fetchShipments("delivered"),
      fetchShipments("archived"),
      fetchParsers(),
      fetchHealth().catch(() => null),
    ]).then(([a, d, ar, p, h]) => {
      setActiveShipments(a)
      setDeliveredShipments(d)
      setArchivedShipments(ar)
      setParserCount(p.length)
      setHealth(h)
      setLoading(false)
    })
  }, [])

  if (loading) {
    return (
      <div className="p-4 md:p-6 max-w-4xl mx-auto">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="h-24 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  const allShipments = [...activeShipments, ...deliveredShipments, ...archivedShipments]
  const total = allShipments.length
  const active = activeShipments.length
  const delivered = deliveredShipments.length
  const stalled = activeShipments.filter(s => s.stalled).length

  // State distribution (across all shipments)
  const stateMap: Record<string, number> = {}
  for (const s of allShipments) {
    stateMap[s.current_state] = (stateMap[s.current_state] ?? 0) + 1
  }
  const stateData = Object.entries(stateMap).map(([state, count]) => ({
    label: STATE_LABELS[state] ?? state,
    value: count,
    color: STATE_COLORS[state] ?? "bg-slate-400",
  })).sort((a, b) => b.value - a.value)

  // Carrier distribution
  const carrierMap: Record<string, number> = {}
  for (const s of allShipments) {
    const c = s.carrier ?? "Unknown"
    carrierMap[c] = (carrierMap[c] ?? 0) + 1
  }
  const carrierData = Object.entries(carrierMap)
    .sort((a, b) => b[1] - a[1])
    .map(([carrier, count], idx) => ({
      label: carrier,
      value: count,
      color: carrierColor(idx),
    }))

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold">Stats</h1>
        <p className="text-sm text-muted-foreground">Overview of your Trackbox data</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
        <StatCard icon={Package} label="Total Shipments" value={total} />
        <StatCard icon={TrendingUp} label="Active" value={active} color="text-blue-500" />
        <StatCard icon={PackageCheck} label="Delivered" value={delivered} color="text-emerald-500" />
        {stalled > 0 && (
          <StatCard
            icon={AlertTriangle}
            label="Needs attention"
            value={stalled}
            color="text-amber-500"
            sub="Stalled or no new events"
          />
        )}
        <StatCard icon={Cpu} label="Parsers" value={parserCount} />
        {health && (
          <StatCard
            icon={Server}
            label="Uptime"
            value={formatUptime(health.uptime_seconds)}
            sub={`build ${health.version}`}
            color={health.status === "ok" ? "text-emerald-500" : "text-amber-500"}
          />
        )}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <BarChart title="By Status" data={stateData} total={total} />
        <BarChart title="By Carrier" data={carrierData} total={total} />
      </div>

      {total === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Activity className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <h3 className="font-semibold text-muted-foreground">No data yet</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Stats will appear once shipments are tracked.
          </p>
        </div>
      )}
    </div>
  )
}
