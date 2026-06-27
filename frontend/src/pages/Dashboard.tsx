import { useEffect, useState, useCallback } from "react"
import { Link } from "react-router-dom"
import { ExternalLink, Copy, Check, RefreshCw, ChevronDown, Package } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { StateBadge } from "@/components/StateBadge"
import { fetchShipments, type Shipment } from "@/lib/api"
import { relativeTime, cn } from "@/lib/utils"

const CARRIER_EMOJI: Record<string, string> = {
  ups: "🟤",
  fedex: "🟣",
  usps: "🔵",
  dhl: "🟡",
  amazon: "🟠",
  ontrac: "🔴",
}

function carrierEmoji(carrier: string | null): string {
  if (!carrier) return "📦"
  const key = carrier.toLowerCase()
  for (const [k, v] of Object.entries(CARRIER_EMOJI)) {
    if (key.includes(k)) return v
  }
  return "📦"
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <button
      onClick={handleCopy}
      className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
      aria-label="Copy tracking number"
      title="Copy tracking number"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
    </button>
  )
}

function ShipmentCard({ shipment }: { shipment: Shipment }) {
  return (
    <Link to={`/shipments/${shipment.id}`}>
      <Card className="group hover:shadow-md hover:border-primary/30 transition-all cursor-pointer">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-base">{carrierEmoji(shipment.carrier)}</span>
                <p className="font-semibold truncate">
                  {shipment.title || `Shipment #${shipment.id}`}
                </p>
              </div>
              {shipment.carrier && (
                <p className="text-xs text-muted-foreground mt-0.5">{shipment.carrier}</p>
              )}
              {shipment.tracking_number && (
                <div className="flex items-center mt-1">
                  <code className="text-xs text-muted-foreground font-mono truncate max-w-[180px]">
                    {shipment.tracking_number}
                  </code>
                  <CopyButton text={shipment.tracking_number} />
                </div>
              )}
            </div>
            <div className="flex flex-col items-end gap-1.5 shrink-0">
              <StateBadge state={shipment.current_state} />
              {shipment.tracking_link && (
                <a
                  href={shipment.tracking_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                  title="Track (t)"
                >
                  Track <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
          {shipment.last_event?.notes && (
            <p className="text-xs text-muted-foreground mt-2 truncate border-t border-border pt-2">
              {shipment.last_event.notes}
            </p>
          )}
          <div className="flex justify-between text-xs text-muted-foreground mt-1">
            <span>Started {relativeTime(shipment.first_seen_at)}</span>
            <span>Updated {relativeTime(shipment.last_updated_at)}</span>
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <Package className="h-12 w-12 text-muted-foreground/40 mb-4" />
      <h3 className="font-semibold text-muted-foreground">No shipments yet</h3>
      <p className="text-sm text-muted-foreground mt-1">
        Shipments will appear here when emails are ingested.
      </p>
    </div>
  )
}

export default function Dashboard() {
  const [active, setActive] = useState<Shipment[]>([])
  const [delivered, setDelivered] = useState<Shipment[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showDelivered, setShowDelivered] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())

  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true)
    try {
      const [a, d] = await Promise.all([
        fetchShipments("active"),
        fetchShipments("delivered"),
      ])
      setActive(a)
      setDelivered(d)
      setLastRefresh(new Date())
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    load()
    const interval = setInterval(() => load(), 60_000)
    return () => clearInterval(interval)
  }, [load])

  const total = active.length + delivered.length

  if (loading) {
    return (
      <div className="p-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-28 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {total === 0 ? "No shipments" : `${active.length} active · ${delivered.length} delivered`}
            {" · "}<span className="tabular-nums">refreshed {relativeTime(lastRefresh.toISOString())}</span>
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => load(true)}
          disabled={refreshing}
          title="Refresh"
          aria-label="Refresh shipments"
        >
          <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
        </Button>
      </div>

      {total === 0 ? (
        <EmptyState />
      ) : (
        <>
          {active.length > 0 && (
            <section className="mb-8">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Active ({active.length})
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {active.map(s => (
                  <ShipmentCard key={s.id} shipment={s} />
                ))}
              </div>
            </section>
          )}

          {delivered.length > 0 && (
            <section>
              <button
                onClick={() => setShowDelivered(v => !v)}
                className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 hover:text-foreground transition-colors"
              >
                <ChevronDown className={cn("h-4 w-4 transition-transform", showDelivered && "rotate-180")} />
                Delivered ({delivered.length})
              </button>
              {showDelivered && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {delivered.map(s => (
                    <ShipmentCard key={s.id} shipment={s} />
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  )
}
