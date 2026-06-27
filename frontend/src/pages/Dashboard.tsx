import { useEffect, useState, useCallback, useMemo } from "react"
import { Link } from "react-router-dom"
import { ExternalLink, Copy, Check, RefreshCw, ChevronDown, Package, Archive, ArchiveRestore, Search, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { StateBadge } from "@/components/StateBadge"
import { fetchShipments, archiveShipment, type Shipment } from "@/lib/api"
import { relativeTime, cn, STATE_LABELS, STATES } from "@/lib/utils"
import { CarrierIcon } from "@/components/CarrierIcon"

type SortField = "added" | "updated" | "name" | "carrier"
type SortDir = "asc" | "desc"

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

function ShipmentCard({ shipment, onArchive, onUnarchive, isArchiving = false }: {
  shipment: Shipment
  onArchive?: (id: number) => void
  onUnarchive?: (id: number) => void
  isArchiving?: boolean
}) {
  return (
    <div className={isArchiving ? "animate-archive-out" : undefined}>
    <Link to={`/shipments/${shipment.id}`}>
      <Card className="group hover:shadow-md hover:border-primary/30 transition-all cursor-pointer">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <CarrierIcon carrier={shipment.carrier} size={20} />
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
              <div className="flex items-center gap-1.5 flex-wrap justify-end">
                <StateBadge state={shipment.current_state} />
                {shipment.stalled && (
                  <span
                    className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 cursor-help"
                    title={
                      shipment.stall_reason === "scrape_failures"
                        ? `Scraping disabled after ${shipment.scrape_fail_count} failures`
                        : shipment.stall_reason === "retention_expired"
                        ? "Carrier retention window exceeded — no more updates available"
                        : "No further updates expected"
                    }
                  >
                    Stalled
                  </span>
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
              {shipment.last_event.notes}
            </p>
          )}
          <div className="flex justify-between text-xs text-muted-foreground mt-1">
            <span>Started {relativeTime(shipment.first_seen_at)}</span>
            <span>Updated {relativeTime(shipment.last_updated_at)}</span>
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

  const [search, setSearch] = useState("")
  const [filterCarrier, setFilterCarrier] = useState("all")
  const [filterStatus, setFilterStatus] = useState("all")
  const [sortField, setSortField] = useState<SortField>("added")
  const [sortDir, setSortDir] = useState<SortDir>("desc")

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
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {total === 0 ? "No shipments" : `${active.length} active · ${delivered.length} delivered`}
            {archived.length > 0 && ` · ${archived.length} archived`}
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
          <Select value={sortField} onValueChange={v => setSortField(v as SortField)}>
            <SelectTrigger className="w-[130px] h-9 text-sm">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="added">Added</SelectItem>
              <SelectItem value="updated">Updated</SelectItem>
              <SelectItem value="name">Name</SelectItem>
              <SelectItem value="carrier">Carrier</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            onClick={() => setSortDir((d: SortDir) => d === "asc" ? "desc" : "asc")}
            title={sortDir === "asc" ? "Ascending" : "Descending"}
          >
            <SortDirIcon className="h-4 w-4" />
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
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredActive.map(s => (
                    <ShipmentCard key={s.id} shipment={s} onArchive={handleArchive} isArchiving={archivingIds.has(s.id)} />
                  ))}
                </div>
              ) : <NoMatches />}
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredDelivered.map(s => (
                      <ShipmentCard key={s.id} shipment={s} onArchive={handleArchive} isArchiving={archivingIds.has(s.id)} />
                    ))}
                  </div>
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredArchived.map(s => (
                      <ShipmentCard key={s.id} shipment={s} onUnarchive={handleUnarchive} />
                    ))}
                  </div>
                ) : <NoMatches />
              )}
            </section>
          )}
        </>
      )}
    </div>
  )
}
