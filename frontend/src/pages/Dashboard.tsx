import { useEffect, useState, useCallback, useMemo, useRef } from "react"
import { Link } from "react-router-dom"
import { ExternalLink, Copy, Check, RefreshCw, ChevronDown, Package, Archive, ArchiveRestore, Search, ArrowUpDown, ArrowUp, ArrowDown, AlertTriangle, LayoutGrid, List, Mail, Settings, X as XIcon, Truck } from "lucide-react"
import confetti from "canvas-confetti"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { StateBadge } from "@/components/StateBadge"
import { fetchShipments, archiveShipment, type Shipment } from "@/lib/api"
import { relativeTime, cn, STATE_LABELS, STATES } from "@/lib/utils"
import { CarrierIcon } from "@/components/CarrierIcon"

const STATUS_ACCENT: Record<string, string> = {
  delivered:        "border-l-green-500",
  in_transit:       "border-l-blue-500",
  shipped:          "border-l-blue-400",
  out_for_delivery: "border-l-sky-500",
  delayed:          "border-l-amber-500",
  exception:        "border-l-red-500",
  preparing:        "border-l-slate-400",
  unknown:          "border-l-violet-400",
}

type SortField = "added" | "updated" | "name" | "carrier"
type SortDir = "asc" | "desc"
type ViewMode = "grid" | "list"

// ── Delivered toast/celebration ─────────────────────────────────────────────

interface DeliveryToast {
  id: number
  title: string
}

function DeliveryToastBanner({ toast, onDismiss }: { toast: DeliveryToast; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const t = setTimeout(() => onDismiss(toast.id), 6000)
    return () => clearTimeout(t)
  }, [toast.id, onDismiss])

  return (
    <div className="flex items-center gap-3 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 rounded-lg px-4 py-3 shadow-sm">
      <span className="text-green-600 dark:text-green-400 text-base font-bold" aria-hidden>✓</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-green-800 dark:text-green-200">Package delivered!</p>
        <p className="text-xs text-green-700 dark:text-green-300 truncate">{toast.title}</p>
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        className="text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-200 transition-colors"
        aria-label="Dismiss"
      >
        <XIcon className="h-4 w-4" />
      </button>
    </div>
  )
}

function useDeliveredCelebration(shipments: Shipment[]) {
  const prevDeliveredIds = useRef<Set<number>>(new Set())
  const [toasts, setToasts] = useState<DeliveryToast[]>([])
  const initialised = useRef(false)

  useEffect(() => {
    if (shipments.length === 0) return

    if (!initialised.current) {
      // Seed with current delivered IDs on first load — don't fire celebration
      const currentDelivered = shipments.filter(s => s.current_state === "delivered")
      prevDeliveredIds.current = new Set(currentDelivered.map(s => s.id))
      initialised.current = true
      return
    }

    const currentDelivered = shipments.filter(s => s.current_state === "delivered")
    const newlyDelivered = currentDelivered.filter(s => !prevDeliveredIds.current.has(s.id))

    if (newlyDelivered.length > 0) {
      // Restrained confetti burst — respects prefers-reduced-motion
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.4 },
        colors: ["#2563EB", "#16A34A", "#0284C7", "#F59E0B"],
        disableForReducedMotion: true,
      })

      setToasts(prev => [
        ...prev,
        ...newlyDelivered.map(s => ({
          id: s.id,
          title: s.title || `Shipment #${s.id}`,
        })),
      ])
    }

    prevDeliveredIds.current = new Set(currentDelivered.map(s => s.id))
  }, [shipments])

  const dismissToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return { toasts, dismissToast }
}

// ── Out for delivery banner ──────────────────────────────────────────────────

function OutForDeliveryBanner({ shipments }: { shipments: Shipment[] }) {
  const ofd = useMemo(
    () => shipments.filter(s => s.current_state === "out_for_delivery"),
    [shipments]
  )
  if (ofd.length === 0) return null

  return (
    <div className="mb-5 flex items-start gap-3 bg-sky-50 dark:bg-sky-900/25 border border-sky-200 dark:border-sky-700 rounded-lg px-4 py-3">
      <Truck className="h-5 w-5 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" aria-hidden />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-sky-800 dark:text-sky-200">
          {ofd.length === 1
            ? "Your shipment is out for delivery today"
            : `${ofd.length} shipments are out for delivery today`}
        </p>
        <div className="mt-1 flex flex-col gap-0.5">
          {ofd.map(s => (
            <Link
              key={s.id}
              to={`/shipments/${s.id}`}
              className="text-xs text-sky-700 dark:text-sky-300 hover:underline flex items-center gap-1.5 w-fit"
            >
              <CarrierIcon carrier={s.carrier} size={14} />
              <span>{s.title || `Shipment #${s.id}`}</span>
              {s.carrier && <span className="text-sky-500 dark:text-sky-400">· {s.carrier}</span>}
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Content-aware skeleton loading ───────────────────────────────────────────

function ShipmentCardSkeleton() {
  return (
    <div className="rounded-xl border border-border border-l-4 border-l-border bg-card p-4 animate-pulse">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {/* Title */}
          <div className="h-4 bg-muted rounded w-3/4 mb-2" />
          {/* Carrier row: icon + name */}
          <div className="flex items-center gap-1.5 mb-1.5">
            <div className="h-3.5 w-3.5 rounded bg-muted shrink-0" />
            <div className="h-3 bg-muted rounded w-1/4" />
          </div>
          {/* Tracking number */}
          <div className="h-3 bg-muted rounded w-1/2" />
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1.5">
          {/* Status badge */}
          <div className="h-5 w-20 rounded-full bg-muted" />
        </div>
      </div>
      {/* Last update row */}
      <div className="mt-3 pt-2 border-t border-border">
        <div className="h-3 bg-muted rounded w-2/3" />
      </div>
      <div className="flex justify-end mt-1">
        <div className="h-3 bg-muted rounded w-1/3" />
      </div>
    </div>
  )
}

// ── ETA extraction helper ─────────────────────────────────────────────────────

function extractETA(notes: string | null | undefined): string | null {
  if (!notes) return null
  const patterns = [
    /expected\s+delivery[:\s]+([^\n.]{4,40})/i,
    /estimated\s+delivery[:\s]+([^\n.]{4,40})/i,
    /est\.?\s+delivery[:\s]+([^\n.]{4,40})/i,
    /delivers?\s+by[:\s]+([^\n.]{4,40})/i,
    /delivery\s+by[:\s]+([^\n.]{4,40})/i,
    /arriving\s+by[:\s]+([^\n.]{4,40})/i,
  ]
  for (const re of patterns) {
    const m = notes.match(re)
    if (m) return m[1].trim().replace(/[.,]$/, "")
  }
  return null
}

// ── Utility sub-components ────────────────────────────────────────────────────

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
      className="ml-1 opacity-0 group-hover:opacity-100 focus:opacity-100 focus-visible:opacity-100 transition-opacity text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none rounded-sm"
      aria-label="Copy tracking number"
      title="Copy tracking number"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
    </button>
  )
}

function StalledBadge({ reason }: { reason?: string | null }) {
  const text =
    reason === "scrape_failures" ? "Stalled · scrape errors" :
    reason === "retention_expired" ? "Stalled · expired" :
    "Stalled"
  const tooltip =
    reason === "scrape_failures" ? "Scraping disabled after repeated failures" :
    reason === "retention_expired" ? "Carrier retention window exceeded — no more updates available" :
    "No further updates expected"
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
      title={tooltip}
    >
      <AlertTriangle className="h-3 w-3" />
      {text}
    </span>
  )
}

// ── ShipmentCard — item 2 (ETA), 6 (focus), 7 (hierarchy) ────────────────────

function ShipmentCard({ shipment, onArchive, onUnarchive, isArchiving = false }: {
  shipment: Shipment
  onArchive?: (id: number) => void
  onUnarchive?: (id: number) => void
  isArchiving?: boolean
}) {
  const eta = extractETA(shipment.last_event?.notes)
  const showETA = eta && shipment.current_state !== "delivered"

  return (
    <div className={isArchiving ? "animate-archive-out" : undefined}>
    <Link to={`/shipments/${shipment.id}`}>
      <Card className={cn(
        "group hover:shadow-md transition-all cursor-pointer border-l-4",
        STATUS_ACCENT[shipment.current_state] ?? "border-l-border"
      )}>
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              {/* Title — primary anchor (item 7) */}
              <p className="font-semibold text-base line-clamp-2 leading-tight">
                {shipment.title || `Shipment #${shipment.id}`}
              </p>
              {/* Carrier — secondary row below title (item 7) */}
              {shipment.carrier && (
                <div className="flex items-center gap-1.5 mt-1">
                  <CarrierIcon carrier={shipment.carrier} size={14} />
                  <p className="text-xs text-muted-foreground">{shipment.carrier}</p>
                </div>
              )}
              {/* ETA — prominently shown (item 2) */}
              {showETA && (
                <p className="text-xs font-medium text-sky-700 dark:text-sky-400 mt-1">
                  Est. delivery: {eta}
                </p>
              )}
              {/* Tracking number — tertiary */}
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
              <div className="flex items-center gap-1.5 flex-wrap justify-end">
                <StateBadge state={shipment.current_state} />
                {shipment.stalled && (
                  <StalledBadge reason={shipment.stall_reason} />
                )}
              </div>
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
              <span className="font-medium">Last update:</span> {shipment.last_event.notes}
            </p>
          )}
          <div className="flex justify-end text-xs text-muted-foreground mt-1">
            <span>Last carrier update {relativeTime(shipment.last_updated_at)}</span>
          </div>
          {/* Archive / Unarchive — visible on hover OR keyboard focus (item 6) */}
          {(onArchive || onUnarchive) && (
            <div className="mt-2 pt-2 border-t border-border flex justify-end opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
              {onArchive && (
                <button
                  onClick={e => { e.preventDefault(); e.stopPropagation(); onArchive(shipment.id) }}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none rounded-sm px-1"
                  title="Archive"
                >
                  <Archive className="h-3 w-3" /> Archive
                </button>
              )}
              {onUnarchive && (
                <button
                  onClick={e => { e.preventDefault(); e.stopPropagation(); onUnarchive(shipment.id) }}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none rounded-sm px-1"
                  title="Unarchive"
                >
                  <ArchiveRestore className="h-3 w-3" /> Unarchive
                </button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
    </div>
  )
}

function ShipmentRow({ shipment, onArchive, onUnarchive, isArchiving = false }: {
  shipment: Shipment
  onArchive?: (id: number) => void
  onUnarchive?: (id: number) => void
  isArchiving?: boolean
}) {
  return (
    <tr className={cn(
      "border-b border-border hover:bg-accent/30 transition-colors group",
      isArchiving && "opacity-50"
    )}>
      <td className="py-2.5 pr-3">
        <Link to={`/shipments/${shipment.id}`} className="flex items-center gap-2 hover:text-primary">
          <CarrierIcon carrier={shipment.carrier} size={16} />
          <span className="font-medium text-sm line-clamp-1">
            {shipment.title || `Shipment #${shipment.id}`}
          </span>
          {shipment.stalled && (
            <span title="Stalled"><AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" /></span>
          )}
        </Link>
      </td>
      <td className="py-2.5 pr-3">
        <StateBadge state={shipment.current_state} />
      </td>
      <td className="py-2.5 pr-3 text-sm text-muted-foreground">
        {shipment.carrier ?? "—"}
      </td>
      <td className="py-2.5 pr-3">
        {shipment.tracking_number && (
          <code className="text-xs font-mono text-muted-foreground select-all">{shipment.tracking_number}</code>
        )}
      </td>
      <td className="py-2.5 pr-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
        {relativeTime(shipment.last_updated_at)}
      </td>
      <td className="py-2.5 text-right">
        {/* Item 6: focus-within restores visibility at row level */}
        <div className="flex items-center justify-end gap-1 opacity-40 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity focus-within:opacity-100">
          {onArchive && (
            <button
              onClick={e => { e.preventDefault(); e.stopPropagation(); onArchive(shipment.id) }}
              className="text-muted-foreground hover:text-foreground p-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none rounded-sm"
              title="Archive"
            >
              <Archive className="h-3.5 w-3.5" />
            </button>
          )}
          {onUnarchive && (
            <button
              onClick={e => { e.preventDefault(); e.stopPropagation(); onUnarchive(shipment.id) }}
              className="text-muted-foreground hover:text-foreground p-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none rounded-sm"
              title="Unarchive"
            >
              <ArchiveRestore className="h-3.5 w-3.5" />
            </button>
          )}
          {shipment.tracking_link && (
            <a
              href={shipment.tracking_link}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="text-muted-foreground hover:text-primary p-1"
              title="Track"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </td>
    </tr>
  )
}

function ShipmentList({ shipments, onArchive, onUnarchive, archivingIds }: {
  shipments: Shipment[]
  onArchive?: (id: number) => void
  onUnarchive?: (id: number) => void
  archivingIds?: Set<number>
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-2 pr-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Shipment</th>
            <th className="text-left py-2 pr-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
            <th className="text-left py-2 pr-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Carrier</th>
            <th className="text-left py-2 pr-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Tracking</th>
            <th className="text-left py-2 pr-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Updated</th>
            <th className="text-right py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Actions</th>
          </tr>
        </thead>
        <tbody>
          {shipments.map(s => (
            <ShipmentRow
              key={s.id}
              shipment={s}
              onArchive={onArchive}
              onUnarchive={onUnarchive}
              isArchiving={archivingIds?.has(s.id)}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Empty state with onboarding (item 8) ─────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center max-w-md mx-auto">
      <div className="mb-5 flex items-center justify-center w-14 h-14 rounded-xl bg-muted border border-border">
        <Package className="h-7 w-7 text-muted-foreground/60" />
      </div>
      <h3 className="font-semibold text-base mb-1">No shipments yet</h3>
      <p className="text-sm text-muted-foreground mb-6">
        Trackbox monitors your parcel emails and surfaces carrier updates automatically.
        Follow these steps to get started:
      </p>
      <ol className="w-full text-left space-y-3">
        <li className="flex items-start gap-3 p-3 rounded-lg bg-muted/60 border border-border">
          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold shrink-0 mt-0.5">1</span>
          <div className="min-w-0">
            <p className="text-sm font-medium">Configure your email source</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Connect an IMAP mailbox or set up email forwarding in{" "}
              <Link to="/settings" className="text-primary hover:underline inline-flex items-center gap-0.5">
                <Settings className="h-3 w-3" /> Settings
              </Link>
            </p>
          </div>
        </li>
        <li className="flex items-start gap-3 p-3 rounded-lg bg-muted/60 border border-border">
          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold shrink-0 mt-0.5">2</span>
          <div className="min-w-0">
            <p className="text-sm font-medium">Forward a tracking email</p>
            <p className="text-xs text-muted-foreground mt-0.5 flex items-start gap-1">
              <Mail className="h-3 w-3 shrink-0 mt-0.5" />
              <span>Forward any carrier shipping confirmation to your configured ingest address.</span>
            </p>
          </div>
        </li>
        <li className="flex items-start gap-3 p-3 rounded-lg bg-muted/60 border border-border">
          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-muted-foreground/25 text-muted-foreground text-xs font-bold shrink-0 mt-0.5">3</span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-muted-foreground">Watch your parcels appear</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Trackbox will parse the email and begin tracking carrier updates here.
            </p>
          </div>
        </li>
      </ol>
    </div>
  )
}

// ── No matches + clear filters (item 10) ─────────────────────────────────────

function NoMatches({ onClearFilters }: { onClearFilters?: () => void }) {
  return (
    <div className="flex items-center gap-3 py-3">
      <p className="text-sm text-muted-foreground">No matches</p>
      {onClearFilters && (
        <button
          onClick={onClearFilters}
          className="text-xs text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none rounded-sm"
        >
          Clear all filters
        </button>
      )}
    </div>
  )
}

function sortKey(s: Shipment, field: SortField): string {
  switch (field) {
    case "added":   return s.first_seen_at ?? ""
    case "updated": return s.last_updated_at ?? ""
    case "name":    return (s.title ?? "￿").toLowerCase()
    case "carrier": return (s.carrier ?? "￿").toLowerCase()
  }
}

export default function Dashboard() {
  const [active, setActive] = useState<Shipment[]>([])
  const [delivered, setDelivered] = useState<Shipment[]>([])
  const [archived, setArchived] = useState<Shipment[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showDelivered, setShowDelivered] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())
  const [archivingIds, setArchivingIds] = useState<Set<number>>(new Set())
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    (localStorage.getItem("dashboard-view") as ViewMode) ?? "grid"
  )

  const [search, setSearch] = useState("")
  const [filterCarrier, setFilterCarrier] = useState("all")
  const [filterStatus, setFilterStatus] = useState("all")
  const [sortField, setSortField] = useState<SortField>("added")
  const [sortDir, setSortDir] = useState<SortDir>("desc")

  const toggleViewMode = () => {
    setViewMode(prev => {
      const next = prev === "grid" ? "list" : "grid"
      localStorage.setItem("dashboard-view", next)
      return next
    })
  }

  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true)
    try {
      const [a, d, ar] = await Promise.all([
        fetchShipments("active"),
        fetchShipments("delivered"),
        fetchShipments("archived"),
      ])
      setActive(a)
      setDelivered(d)
      setArchived(ar)
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

  // Celebration hook — tracks newly-delivered shipments (item 1)
  const allForCelebration = useMemo(() => [...active, ...delivered], [active, delivered])
  const { toasts, dismissToast } = useDeliveredCelebration(allForCelebration)

  const handleArchive = async (id: number) => {
    setArchivingIds(prev => new Set(prev).add(id))
    await new Promise(r => setTimeout(r, 380))
    await archiveShipment(id, true)
    setArchivingIds(prev => { const s = new Set(prev); s.delete(id); return s })
    load()
  }

  const handleUnarchive = async (id: number) => {
    await archiveShipment(id, false)
    load()
  }

  const allShipments = useMemo(() => [...active, ...delivered, ...archived], [active, delivered, archived])

  const carrierOptions = useMemo(() => {
    const seen = new Set<string>()
    for (const s of allShipments) {
      if (s.carrier) seen.add(s.carrier)
    }
    return Array.from(seen).sort()
  }, [allShipments])

  const isFiltered = search !== "" || filterCarrier !== "all" || filterStatus !== "all"

  const clearFilters = useCallback(() => {
    setSearch("")
    setFilterCarrier("all")
    setFilterStatus("all")
  }, [])

  const filterAndSort = useCallback((shipments: Shipment[]) => {
    const q = search.toLowerCase()
    let result = shipments.filter(s => {
      if (filterCarrier !== "all" && s.carrier !== filterCarrier) return false
      if (filterStatus !== "all" && s.current_state !== filterStatus) return false
      if (q) {
        const haystack = [
          s.title,
          s.carrier,
          STATE_LABELS[s.current_state] ?? s.current_state,
          s.first_seen_at,
          s.last_updated_at,
          s.last_event?.notes,
          s.tracking_number,
        ].filter(Boolean).join(" ").toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
    result = [...result].sort((a, b) => {
      const ka = sortKey(a, sortField)
      const kb = sortKey(b, sortField)
      const cmp = sortField === "name" || sortField === "carrier"
        ? ka.localeCompare(kb)
        : ka < kb ? -1 : ka > kb ? 1 : 0
      return sortDir === "asc" ? cmp : -cmp
    })
    return result
  }, [search, filterCarrier, filterStatus, sortField, sortDir])

  const filteredActive = useMemo(() => filterAndSort(active), [filterAndSort, active])
  const filteredDelivered = useMemo(() => filterAndSort(delivered), [filterAndSort, delivered])
  const filteredArchived = useMemo(() => filterAndSort(archived), [filterAndSort, archived])

  const total = active.length + delivered.length

  if (loading) {
    return (
      <div className="p-6">
        {/* Content-aware skeleton (item 4) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <ShipmentCardSkeleton key={i} />
          ))}
        </div>
      </div>
    )
  }

  const SortDirIcon = sortDir === "asc" ? ArrowUp : sortDir === "desc" ? ArrowDown : ArrowUpDown

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      {/* Delivery toasts (item 1) */}
      {toasts.length > 0 && (
        <div className="mb-4 space-y-2" role="status" aria-live="polite">
          {toasts.map(t => (
            <DeliveryToastBanner key={t.id} toast={t} onDismiss={dismissToast} />
          ))}
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {total === 0 ? "No shipments" : `${active.length} active · ${delivered.length} delivered`}
            {archived.length > 0 && ` · ${archived.length} archived`}
          </p>
        </div>
        <div className="flex flex-col items-end gap-0.5">
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
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {refreshing ? "Syncing…" : `Last sync: ${relativeTime(lastRefresh.toISOString())}`}
          </span>
        </div>
      </div>

      {/* Out for delivery hero banner (item 3) */}
      <OutForDeliveryBanner shipments={[...active, ...delivered]} />

      {/* Filter / sort bar */}
      {(total > 0 || archived.length > 0) && (
        <div className="flex flex-wrap gap-2 mb-6">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 h-9 text-sm"
            />
          </div>
          {/* Item 6: restore focus rings on SelectTrigger */}
          <Select value={filterCarrier} onValueChange={setFilterCarrier}>
            <SelectTrigger className="w-[140px] h-9 text-sm focus:ring-1 focus:ring-ring focus-visible:ring-2 focus-visible:ring-ring">
              <SelectValue placeholder="Carrier" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All carriers</SelectItem>
              {carrierOptions.map(c => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[140px] h-9 text-sm focus:ring-1 focus:ring-ring focus-visible:ring-2 focus-visible:ring-ring">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATES.map(s => (
                <SelectItem key={s} value={s}>{STATE_LABELS[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* Grouped sort control — item 6: restore focus ring */}
          <div className="flex h-9 rounded-md border border-input overflow-hidden focus-within:ring-1 focus-within:ring-ring">
            <Select value={sortField} onValueChange={v => setSortField(v as SortField)}>
              <SelectTrigger className="w-[120px] h-full border-0 rounded-none text-sm focus:ring-0 focus:ring-offset-0 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="added">Added</SelectItem>
                <SelectItem value="updated">Updated</SelectItem>
                <SelectItem value="name">Name</SelectItem>
                <SelectItem value="carrier">Carrier</SelectItem>
              </SelectContent>
            </Select>
            <div className="w-px bg-input self-stretch" />
            <button
              className="px-2.5 flex items-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => setSortDir((d: SortDir) => d === "asc" ? "desc" : "asc")}
              title={sortDir === "asc" ? "Ascending" : "Descending"}
              aria-label={sortDir === "asc" ? "Sort ascending" : "Sort descending"}
            >
              <SortDirIcon className="h-4 w-4" />
            </button>
          </div>
          {/* View mode toggle */}
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            onClick={toggleViewMode}
            title={viewMode === "grid" ? "Switch to list view" : "Switch to grid view"}
            aria-label={viewMode === "grid" ? "Switch to list view" : "Switch to grid view"}
          >
            {viewMode === "grid" ? <List className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
          </Button>
        </div>
      )}

      {total === 0 && archived.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {active.length > 0 && (
            <section className="mb-8">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Active ({isFiltered ? `${filteredActive.length}/` : ""}{active.length})
              </h2>
              {filteredActive.length > 0 ? (
                viewMode === "grid" ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredActive.map(s => (
                      <ShipmentCard key={s.id} shipment={s} onArchive={handleArchive} isArchiving={archivingIds.has(s.id)} />
                    ))}
                  </div>
                ) : (
                  <ShipmentList shipments={filteredActive} onArchive={handleArchive} archivingIds={archivingIds} />
                )
              ) : <NoMatches onClearFilters={isFiltered ? clearFilters : undefined} />}
            </section>
          )}

          {delivered.length > 0 && (
            <section className="mb-4">
              <button
                onClick={() => setShowDelivered(v => !v)}
                className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 hover:text-foreground transition-colors"
              >
                <ChevronDown className={cn("h-4 w-4 transition-transform", showDelivered && "rotate-180")} />
                Delivered ({isFiltered ? `${filteredDelivered.length}/` : ""}{delivered.length})
              </button>
              {showDelivered && (
                filteredDelivered.length > 0 ? (
                  viewMode === "grid" ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {filteredDelivered.map(s => (
                        <ShipmentCard key={s.id} shipment={s} onArchive={handleArchive} isArchiving={archivingIds.has(s.id)} />
                      ))}
                    </div>
                  ) : (
                    <ShipmentList shipments={filteredDelivered} onArchive={handleArchive} archivingIds={archivingIds} />
                  )
                ) : <NoMatches onClearFilters={isFiltered ? clearFilters : undefined} />
              )}
            </section>
          )}

          {archived.length > 0 && (
            <section>
              <button
                onClick={() => setShowArchived(v => !v)}
                className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 hover:text-foreground transition-colors"
              >
                <ChevronDown className={cn("h-4 w-4 transition-transform", showArchived && "rotate-180")} />
                <Archive className="h-3.5 w-3.5" />
                Archived ({isFiltered ? `${filteredArchived.length}/` : ""}{archived.length})
              </button>
              {showArchived && (
                filteredArchived.length > 0 ? (
                  viewMode === "grid" ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {filteredArchived.map(s => (
                        <ShipmentCard key={s.id} shipment={s} onUnarchive={handleUnarchive} />
                      ))}
                    </div>
                  ) : (
                    <ShipmentList shipments={filteredArchived} onUnarchive={handleUnarchive} />
                  )
                ) : <NoMatches onClearFilters={isFiltered ? clearFilters : undefined} />
              )}
            </section>
          )}
        </>
      )}
    </div>
  )
}
