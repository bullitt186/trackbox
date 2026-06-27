import React, { useState, useEffect, useMemo, useCallback } from "react"
import { Search, Filter, Upload, Plus, Package, MoreHorizontal } from "lucide-react"
import { cn } from "@/lib/utils"
import { fetchShipments, createShipment, archiveShipment, type Shipment } from "@/lib/api"
import { StateBadge } from "@/components/StateBadge"
import { getCarrierIcon, getCarrierDisplay } from "@/lib/carrier"
import { ShipmentDetailPanel } from "@/components/ShipmentDetailPanel"

const PAGE_SIZE = 10

type TabId = "all" | "in_transit" | "out_for_delivery" | "delivered" | "exceptions" | "archived"

const TABS: { id: TabId; label: string }[] = [
  { id: "all",              label: "All"              },
  { id: "in_transit",       label: "In transit"       },
  { id: "out_for_delivery", label: "Out for delivery" },
  { id: "delivered",        label: "Delivered"        },
  { id: "exceptions",       label: "Exceptions"       },
  { id: "archived",         label: "Archived"         },
]

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return "—"
  const d = new Date(dateStr)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today.getTime() - 86400000)
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  if (d >= today) return `Today, ${time}`
  if (d >= yesterday) return `Yesterday, ${time}`
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + `, ${time}`
}

function formatDelivery(dateStr: string | null | undefined): { date: string; relative: string } | null {
  if (!dateStr) return null
  const d = new Date(dateStr + "T00:00:00")
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000)
  const date = d.toLocaleDateString("en-GB", { month: "short", day: "numeric", year: "numeric" })
  const relative = diff < 0 ? "overdue" : diff === 0 ? "today" : diff === 1 ? "tomorrow" : `in ${diff} days`
  return { date, relative }
}

function filterByTab(shipments: Shipment[], tab: TabId): Shipment[] {
  switch (tab) {
    case "in_transit":
      return shipments.filter(s => !s.archived && ["in_transit", "shipped", "preparing", "unknown"].includes(s.current_state))
    case "out_for_delivery":
      return shipments.filter(s => !s.archived && s.current_state === "out_for_delivery")
    case "delivered":
      return shipments.filter(s => !s.archived && s.current_state === "delivered")
    case "exceptions":
      return shipments.filter(s => !s.archived && ["delayed", "exception"].includes(s.current_state))
    case "archived":
      return shipments.filter(s => !!s.archived)
    default:
      return shipments
  }
}

// ── Add shipment modal ────────────────────────────────────────────────────────

function AddShipmentModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [trackingNumber, setTrackingNumber] = useState("")
  const [carrier, setCarrier] = useState("")
  const [title, setTitle] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!trackingNumber.trim()) return
    setLoading(true)
    setError(null)
    try {
      await createShipment({
        tracking_number: trackingNumber.trim(),
        carrier: carrier.trim() || undefined,
        title: title.trim() || undefined,
      })
      onAdded()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add shipment")
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-background border border-border rounded-lg shadow-xl w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
        <h2 className="text-base font-semibold mb-4">Add shipment</h2>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">Tracking number *</label>
            <input
              autoFocus
              value={trackingNumber}
              onChange={e => setTrackingNumber(e.target.value)}
              placeholder="1Z999AA10123456784"
              className="mt-1 w-full h-9 px-3 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              required
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Carrier</label>
            <input
              value={carrier}
              onChange={e => setCarrier(e.target.value)}
              placeholder="ups, dhl, fedex…"
              className="mt-1 w-full h-9 px-3 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Description</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Keyboard – Keychron K2"
              className="mt-1 w-full h-9 px-3 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 h-9 text-sm rounded-md border border-input hover:bg-accent">
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 h-9 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? "Adding…" : "Add shipment"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Row context menu ──────────────────────────────────────────────────────────

function RowMenu({ shipment, onRefresh }: { shipment: Shipment; onRefresh: () => void }) {
  const [open, setOpen] = useState(false)

  async function toggleArchive() {
    await archiveShipment(shipment.id, !shipment.archived)
    onRefresh()
    setOpen(false)
  }

  return (
    <div className="relative">
      <button
        onClick={e => { e.stopPropagation(); setOpen(v => !v) }}
        className="h-7 w-7 flex items-center justify-center rounded hover:bg-accent text-muted-foreground"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-8 z-20 bg-background border border-border rounded-md shadow-md w-36 py-1 text-sm">
            <button
              onClick={e => { e.stopPropagation(); toggleArchive() }}
              className="w-full text-left px-3 py-1.5 hover:bg-accent"
            >
              {shipment.archived ? "Unarchive" : "Archive"}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ── Table row ─────────────────────────────────────────────────────────────────

function ShipmentRow({
  shipment: s, selected, onSelect, onRefresh,
}: {
  shipment: Shipment
  selected: boolean
  onSelect: () => void
  onRefresh: () => void
}) {
  const carrierIcon = getCarrierIcon(s.carrier)
  const carrierDisplay = getCarrierDisplay(s.carrier)
  const delivery = formatDelivery(s.estimated_delivery)

  return (
    <tr
      onClick={onSelect}
      className={cn(
        "border-b border-border/50 cursor-pointer transition-colors",
        selected ? "bg-primary/5" : "hover:bg-muted/30"
      )}
    >
      {/* Shipment */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded border border-border flex items-center justify-center text-muted-foreground shrink-0">
            <Package className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">{s.tracking_number ?? "—"}</div>
            {s.title && <div className="text-xs text-muted-foreground truncate">{s.title}</div>}
          </div>
        </div>
      </td>
      {/* Carrier */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          {carrierIcon
            ? <img src={carrierIcon} className="h-8 w-8 object-contain shrink-0" alt="" />
            : <span className="text-base shrink-0">📦</span>
          }
          <div className="min-w-0">
            <div className="text-sm truncate">{carrierDisplay?.name ?? s.carrier ?? "—"}</div>
            {carrierDisplay?.country && (
              <div className="text-xs text-muted-foreground">{carrierDisplay.country}</div>
            )}
          </div>
        </div>
      </td>
      {/* Status */}
      <td className="px-4 py-3">
        <StateBadge state={s.current_state} />
      </td>
      {/* Last update */}
      <td className="px-4 py-3">
        <div className="text-sm">{formatDateTime(s.last_updated_at)}</div>
        {s.last_event?.notes && (
          <div className="text-xs text-muted-foreground max-w-[200px] truncate">{s.last_event.notes}</div>
        )}
      </td>
      {/* Est. delivery */}
      <td className="px-4 py-3">
        {delivery ? (
          <>
            <div className="text-sm">{delivery.date}</div>
            <div className="text-xs text-muted-foreground">{delivery.relative}</div>
          </>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        )}
      </td>
      {/* Actions — stop propagation so row click doesn't fire */}
      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
        <RowMenu shipment={s} onRefresh={onRefresh} />
      </td>
    </tr>
  )
}

// ── Pagination ────────────────────────────────────────────────────────────────

function Pager({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  if (totalPages <= 1) return null

  const items: (number | "…")[] = []
  const delta = 2
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= page - delta && i <= page + delta)) {
      items.push(i)
    } else if (items[items.length - 1] !== "…") {
      items.push("…")
    }
  }

  return (
    <div className="flex items-center gap-0.5">
      <button
        onClick={() => onChange(page - 1)}
        disabled={page === 1}
        className="h-7 w-7 flex items-center justify-center rounded text-sm hover:bg-accent disabled:opacity-40"
      >‹</button>
      {items.map((p, i) =>
        p === "…" ? (
          <span key={`e${i}`} className="h-7 w-7 flex items-center justify-center text-sm text-muted-foreground">…</span>
        ) : (
          <button
            key={p}
            onClick={() => onChange(p)}
            className={cn(
              "h-7 w-7 flex items-center justify-center rounded text-sm",
              p === page ? "bg-primary text-primary-foreground" : "hover:bg-accent"
            )}
          >{p}</button>
        )
      )}
      <button
        onClick={() => onChange(page + 1)}
        disabled={page === totalPages}
        className="h-7 w-7 flex items-center justify-center rounded text-sm hover:bg-accent disabled:opacity-40"
      >›</button>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Shipments() {
  const [all, setAll] = useState<Shipment[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<TabId>("all")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [showAdd, setShowAdd] = useState(false)

  const load = useCallback(async () => {
    const [active, archived] = await Promise.all([
      fetchShipments(),
      fetchShipments("archived"),
    ])
    const merged = [...active, ...archived].sort((a, b) =>
      (b.last_updated_at ?? b.first_seen_at ?? "").localeCompare(
        a.last_updated_at ?? a.first_seen_at ?? ""
      )
    )
    setAll(merged)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const counts = useMemo(() => ({
    all:              all.length,
    in_transit:       all.filter(s => !s.archived && ["in_transit", "shipped", "preparing", "unknown"].includes(s.current_state)).length,
    out_for_delivery: all.filter(s => !s.archived && s.current_state === "out_for_delivery").length,
    delivered:        all.filter(s => !s.archived && s.current_state === "delivered").length,
    exceptions:       all.filter(s => !s.archived && ["delayed", "exception"].includes(s.current_state)).length,
    archived:         all.filter(s => !!s.archived).length,
  }), [all])

  const tabFiltered = useMemo(() => filterByTab(all, tab), [all, tab])

  const searched = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return tabFiltered
    return tabFiltered.filter(s =>
      s.tracking_number?.toLowerCase().includes(q) ||
      s.title?.toLowerCase().includes(q) ||
      s.carrier?.toLowerCase().includes(q)
    )
  }, [tabFiltered, search])

  const totalPages = Math.max(1, Math.ceil(searched.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageRows = searched.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  // Reset page when tab or search changes
  useEffect(() => { setPage(1) }, [tab, search])

  return (
    <div className="flex flex-col">
      {/* Page header */}
      <div className="flex items-start justify-between px-6 py-5 border-b border-border/60">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Shipments</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Track and manage all your shipments in one place.</p>
        </div>
        <div className="flex items-center gap-2 mt-1">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search shipments..."
              className="pl-9 pr-14 h-9 w-56 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono">⌘K</kbd>
          </div>
          {/* ponytail: Filter and Import are visual-only until wired */}
          <button className="h-9 px-3.5 text-sm rounded-md border border-input bg-background hover:bg-accent flex items-center gap-1.5">
            <Filter className="h-4 w-4" />
            Filter
          </button>
          <button className="h-9 px-3.5 text-sm rounded-md border border-input bg-background hover:bg-accent flex items-center gap-1.5">
            <Upload className="h-4 w-4" />
            Import
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="h-9 px-3.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-1.5 font-medium"
          >
            <Plus className="h-4 w-4" />
            Add shipment
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="px-6 border-b border-border/60 flex">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex items-center gap-1.5 text-sm px-1 py-3 mr-5 font-medium border-b-2 whitespace-nowrap transition-colors",
              tab === t.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
            <span className={cn(
              "text-xs rounded-full px-1.5 py-0.5 font-normal",
              tab === t.id
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground"
            )}>
              {counts[t.id]}
            </span>
          </button>
        ))}
      </div>

      {/* Content: padded card wrapping table + optional detail panel */}
      <div className="p-6">
        <div className="rounded-xl border border-border/50 shadow-sm">
          <div className="flex items-start">
        {/* Table */}
        <div className="flex-1 min-w-0">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border/50 bg-muted/30">
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Shipment</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Carrier</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Last update</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Est. delivery</th>
                <th className="px-4 py-3 w-10" />
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center text-sm text-muted-foreground">
                    Loading shipments…
                  </td>
                </tr>
              )}
              {!loading && pageRows.map(s => (
                <ShipmentRow
                  key={s.id}
                  shipment={s}
                  selected={selectedId === s.id}
                  onSelect={() => setSelectedId(selectedId === s.id ? null : s.id)}
                  onRefresh={load}
                />
              ))}
              {!loading && pageRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center text-sm text-muted-foreground">
                    No shipments found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* Pagination footer */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-border/50 text-sm">
            <span className="text-muted-foreground">
              {searched.length === 0
                ? "No shipments"
                : `Showing ${(currentPage - 1) * PAGE_SIZE + 1} to ${Math.min(currentPage * PAGE_SIZE, searched.length)} of ${searched.length} shipments`
              }
            </span>
            <Pager page={currentPage} totalPages={totalPages} onChange={setPage} />
          </div>
        </div>

        {/* Detail panel — sticky so it stays visible when the table is long */}
        {selectedId !== null && (
          <div className="sticky top-0 self-start shrink-0">
            <ShipmentDetailPanel
              id={selectedId}
              onClose={() => setSelectedId(null)}
              onRefresh={load}
            />
          </div>
        )}
          </div>
        </div>
      </div>

      {showAdd && (
        <AddShipmentModal
          onClose={() => setShowAdd(false)}
          onAdded={() => { setShowAdd(false); load() }}
        />
      )}
    </div>
  )
}
