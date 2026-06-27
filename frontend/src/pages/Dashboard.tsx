import { useEffect, useState, useCallback, useMemo } from "react"
import { Link } from "react-router-dom"
import { ExternalLink, Copy, Check, RefreshCw, ChevronDown, Package, Archive, ArchiveRestore, Search, ArrowUpDown, ArrowUp, ArrowDown, AlertTriangle, LayoutGrid, List, Plus, X, Clock } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { StateBadge } from "@/components/StateBadge"
import { fetchShipments, archiveShipment, createShipment, bulkArchiveDelivered, type Shipment, type CreateShipmentInput } from "@/lib/api"
import { relativeTime, cn, STATE_LABELS, STATES, etaLabel } from "@/lib/utils"
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

/** Add Shipment modal */
function AddShipmentModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState<CreateShipmentInput>({ tracking_number: "", carrier: "", title: "" })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!form.tracking_number?.trim()) { setError("Tracking number is required"); return }
    setSaving(true)
    try {
      await createShipment({
        tracking_number: form.tracking_number.trim() || undefined,
        carrier: form.carrier?.trim() || undefined,
        title: form.title?.trim() || undefined,
      })
      onCreated()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create shipment")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-background rounded-xl border border-border shadow-xl w-full max-w-sm mx-4 p-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold">Add Shipment</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Tracking Number *</label>
            <Input
              value={form.tracking_number}
              onChange={e => setForm(f => ({ ...f, tracking_number: e.target.value }))}
              placeholder="e.g. 1Z999AA10123456784"
              autoFocus
              className="h-9 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Carrier</label>
            <Input
              value={form.carrier}
              onChange={e => setForm(f => ({ ...f, carrier: e.target.value }))}
              placeholder="e.g. dhl, gls, dpd"
              className="h-9 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Title (optional)</label>
            <Input
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="e.g. New headphones"
              className="h-9 text-sm"
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2 pt-1">
            <Button type="submit" size="sm" className="flex-1" disabled={saving}>
              {saving ? "Adding…" : "Add Shipment"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ShipmentCard({ shipment, onArchive, onUnarchive, isArchiving = false }: {
  shipment: Shipment
  onArchive?: (id: number) => void
  onUnarchive?: (id: number) => void
  isArchiving?: boolean
}) {
  const eta = etaLabel(shipment.estimated_delivery)
  const isArrivingSoon = eta === "Arriving today" || eta === "Arriving tomorrow"

  return (
    <div className={isArchiving ? "animate-archive-out" : undefined}>
    <Link to={`/shipments/${shipment.id}`}>
      <Card className={cn(
        "group hover:shadow-md transition-all cursor-pointer border-l-4",
        isArrivingSoon ? "border-l-amber-400 ring-1 ring-amber-200 dark:ring-amber-800" : (STATUS_ACCENT[shipment.current_state] ?? "border-l-border")
      )}>
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <CarrierIcon carrier={shipment.carrier} size={20} />
                <p className="font-semibold line-clamp-2 leading-tight">
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
          {/* ETA highlight */}
          {eta && (
            <div className={cn(
              "flex items-center gap-1 mt-2 text-xs font-medium",
              isArrivingSoon ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"
            )}>
              <Clock className="h-3 w-3" />
              {eta}
            </div>
          )}
          {shipment.last_event?.notes && (
            <p className="text-xs text-muted-foreground mt-2 truncate border-t border-border pt-2">
              <span className="font-medium">Last update:</span> {shipment.last_event.notes}
            </p>
          )}
          <div className="flex justify-end text-xs text-muted-foreground mt-1">
            <span>Last carrier update {relativeTime(shipment.last_updated_at)}</span>
          </div>
          {/* Archive / Unarchive button */}
          {(onArchive || onUnarchive) && (
            <div className="mt-2 pt-2 border-t border-border flex justify-end opacity-0 group-hover:opacity-100 transition-opacity">
              {onArchive && (
                <button
                  onClick={e => { e.preventDefault(); e.stopPropagation(); onArchive(shipment.id) }}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  title="Archive"
                >
                  <Archive className="h-3 w-3" /> Archive
                </button>
              )}
              {onUnarchive && (
                <button
                  onClick={e => { e.preventDefault(); e.stopPropagation(); onUnarchive(shipment.id) }}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
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
  const eta = etaLabel(shipment.estimated_delivery)
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
        {eta ? (
          <span className={cn("font-medium", (eta === "Arriving today" || eta === "Arriving tomorrow") && "text-amber-600 dark:text-amber-400")}>
            {eta}
          </span>
        ) : relativeTime(shipment.last_updated_at)}
      </td>
      <td className="py-2.5 text-right">
        <div className="flex items-center justify-end gap-1 opacity-40 group-hover:opacity-100 transition-opacity focus-within:opacity-100">
          {onArchive && (
            <button
              onClick={e => { e.preventDefault(); e.stopPropagation(); onArchive(shipment.id) }}
              className="text-muted-foreground hover:text-foreground p-1"
              title="Archive"
            >
              <Archive className="h-3.5 w-3.5" />
            </button>
          )}
          {onUnarchive && (
            <button
              onClick={e => { e.preventDefault(); e.stopPropagation(); onUnarchive(shipment.id) }}
              className="text-muted-foreground hover:text-foreground p-1"
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
            <th className="text-left py-2 pr-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">ETA / Updated</th>
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

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <Package className="h-12 w-12 text-muted-foreground/40 mb-4" />
      <h3 className="font-semibold text-muted-foreground">No shipments yet</h3>
      <p className="text-sm text-muted-foreground mt-1 mb-4">
        Shipments appear automatically when tracking emails are ingested, or add one manually.
      </p>
      <Button size="sm" onClick={onAdd}>
        <Plus className="h-4 w-4 mr-1" /> Add Shipment
      </Button>
    </div>
  )
}

function NoMatches() {
  return <p className="text-sm text-muted-foreground py-2">No matches</p>
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
  const [showAddModal, setShowAddModal] = useState(false)
  const [bulkArchiving, setBulkArchiving] = useState(false)

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

  const handleBulkArchive = async () => {
    setBulkArchiving(true)
    try {
      await bulkArchiveDelivered()
      await load()
    } finally {
      setBulkArchiving(false)
    }
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-28 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  const SortDirIcon = sortDir === "asc" ? ArrowUp : sortDir === "desc" ? ArrowDown : ArrowUpDown

  return (
    <>
      {showAddModal && (
        <AddShipmentModal
          onClose={() => setShowAddModal(false)}
          onCreated={() => load()}
        />
      )}
      <div className="p-4 md:p-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold">Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              {total === 0 ? "No shipments" : `${active.length} active · ${delivered.length} delivered`}
              {archived.length > 0 && ` · ${archived.length} archived`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => setShowAddModal(true)}
              className="gap-1.5"
            >
              <Plus className="h-4 w-4" />
              Add
            </Button>
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
        </div>

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
            <Select value={filterCarrier} onValueChange={setFilterCarrier}>
              <SelectTrigger className="w-[140px] h-9 text-sm">
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
              <SelectTrigger className="w-[140px] h-9 text-sm">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {STATES.map(s => (
                  <SelectItem key={s} value={s}>{STATE_LABELS[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Grouped sort control */}
            <div className="flex h-9 rounded-md border border-input overflow-hidden">
              <Select value={sortField} onValueChange={v => setSortField(v as SortField)}>
                <SelectTrigger className="w-[120px] h-full border-0 rounded-none text-sm focus:ring-0 focus:ring-offset-0">
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
                className="px-2.5 flex items-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
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
          <EmptyState onAdd={() => setShowAddModal(true)} />
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
                ) : <NoMatches />}
              </section>
            )}

            {delivered.length > 0 && (
              <section className="mb-4">
                <div className="flex items-center justify-between mb-3">
                  <button
                    onClick={() => setShowDelivered(v => !v)}
                    className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors"
                  >
                    <ChevronDown className={cn("h-4 w-4 transition-transform", showDelivered && "rotate-180")} />
                    Delivered ({isFiltered ? `${filteredDelivered.length}/` : ""}{delivered.length})
                  </button>
                  {delivered.length > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-muted-foreground hover:text-foreground gap-1"
                      onClick={handleBulkArchive}
                      disabled={bulkArchiving}
                      title="Archive all delivered shipments"
                    >
                      <Archive className="h-3 w-3" />
                      {bulkArchiving ? "Archiving…" : "Archive all"}
                    </Button>
                  )}
                </div>
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
                  ) : <NoMatches />
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
                  ) : <NoMatches />
                )}
              </section>
            )}
          </>
        )}
      </div>
    </>
  )
}
