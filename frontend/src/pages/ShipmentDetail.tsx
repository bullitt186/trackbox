import { useEffect, useState, useCallback } from "react"
import { useParams, useNavigate, Link } from "react-router-dom"
import {
  ArrowLeft, ExternalLink, Copy, Check, Pencil, Trash2, X, Save, RefreshCw, Archive, ArchiveRestore, AlertTriangle, ChevronDown,
} from "lucide-react"
import * as Dialog from "@radix-ui/react-dialog"
import * as Select from "@radix-ui/react-select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { StateBadge } from "@/components/StateBadge"
import { ScrapeStatusIcon } from "@/components/ScrapeStatusIcon"
import { fetchShipment, updateShipment, archiveShipment, deleteShipment, fetchScrapeLog, type Shipment, type ShipmentEvent, type ScrapeLogEntry } from "@/lib/api"
import { smartDate, STATE_LABELS, STATES, cn, etaLabel } from "@/lib/utils"
import { CarrierIcon } from "@/components/CarrierIcon"

// Progress stepper state order
const STEPPER_STATES = ["preparing", "shipped", "in_transit", "out_for_delivery", "delivered"] as const

function ProgressStepper({ state }: { state: string }) {
  const currentIdx = STEPPER_STATES.indexOf(state as typeof STEPPER_STATES[number])
  return (
    <div className="flex items-center gap-0 bg-muted/40 rounded-xl px-4 py-3">
      {STEPPER_STATES.map((s, i) => {
        const done = currentIdx >= i
        const current = currentIdx === i
        const isLast = i === STEPPER_STATES.length - 1
        return (
          <div key={s} className="flex items-center flex-1 min-w-0">
            <div className="flex flex-col items-center shrink-0">
              <div
                className={cn(
                  "w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-colors",
                  done
                    ? "bg-primary border-primary text-primary-foreground"
                    : "border-border text-muted-foreground",
                  current && "ring-2 ring-primary ring-offset-2 ring-offset-background"
                )}
              >
                {done ? "✓" : ""}
              </div>
              <span className={cn(
                "text-[10px] mt-1 text-center leading-tight w-14 hidden sm:block",
                done ? "text-primary font-medium" : "text-muted-foreground"
              )}>
                {STATE_LABELS[s]}
              </span>
            </div>
            {!isLast && (
              <div className={cn(
                "h-0.5 flex-1 mx-1 transition-colors",
                currentIdx > i ? "bg-primary" : "bg-border"
              )} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function MetaRow({ label, value, children }: { label: string; value?: string | null; children?: React.ReactNode }) {
  if (!value && !children) return null
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium mt-0.5">{children ?? value}</dd>
    </div>
  )
}

function CopyTrackingButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <button
      onClick={handleCopy}
      className="ml-1 text-muted-foreground hover:text-foreground transition-colors"
      title="Copy tracking number"
      aria-label="Copy tracking number"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  )
}

function SourceBadge({ source }: { source: string }) {
  const icon = source === "scraper" ? "\u{1F504}" : source === "email" ? "\u{1F4E7}" : "\u{270F}\u{FE0F}"
  const label = source === "scraper" ? "Scraper" : source === "email" ? "Email" : "Manual"
  return (
    <Badge variant="outline" className="text-xs capitalize gap-1">
      <span>{icon}</span>
      {label}
    </Badge>
  )
}

function EventRow({ event }: { event: ShipmentEvent }) {
  return (
    <tr className="border-b border-border last:border-0 hover:bg-accent/30 transition-colors">
      <td className="py-2.5 pr-4">
        <StateBadge state={event.state} />
      </td>
      <td className="py-2.5 pr-4 text-sm text-muted-foreground">
        {event.occurred_at ? smartDate(event.occurred_at) : "—"}
      </td>
      <td className="py-2.5 text-sm">{event.notes ?? "—"}</td>
      <td className="py-2.5 pl-4">
        <SourceBadge source={event.source} />
      </td>
    </tr>
  )
}

function DeleteDialog({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <Dialog.Root open onOpenChange={open => { if (!open) onCancel() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-card border border-border rounded-xl shadow-lg p-6 w-80">
          <Dialog.Title className="font-semibold text-lg mb-2">Delete shipment?</Dialog.Title>
          <Dialog.Description className="text-sm text-muted-foreground mb-6">
            This will permanently delete the shipment and all its events. This cannot be undone.
          </Dialog.Description>
          <div className="flex gap-3 justify-end">
            <Button variant="outline" onClick={onCancel}>Cancel</Button>
            <Button variant="destructive" onClick={onConfirm}>Delete</Button>
          </div>
          <Dialog.Close asChild>
            <button className="absolute top-3 right-3 text-muted-foreground hover:text-foreground" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export default function ShipmentDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [shipment, setShipment] = useState<(Shipment & { events: ShipmentEvent[] }) | null>(null)
  const [loading, setLoading] = useState(true)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState("")
  const [stateSelect, setStateSelect] = useState("")
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [scraping, setScraping] = useState(false)
  const [scrapeResult, setScrapeResult] = useState<string | null>(null)
  const [scrapeLog, setScrapeLog] = useState<ScrapeLogEntry[]>([])
  const [scrapeLogOpen, setScrapeLogOpen] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    const data = await fetchShipment(Number(id))
    setShipment(data)
    setStateSelect(data.current_state)
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  // Load scrape log when section is opened
  useEffect(() => {
    if (scrapeLogOpen && id) {
      fetchScrapeLog({ shipment_id: Number(id), limit: 20 }).then(setScrapeLog)
    }
  }, [scrapeLogOpen, id])

  // Keyboard shortcuts
  useEffect(() => {
    if (!shipment) return
    function handleKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
      if (e.key === "t" && shipment?.tracking_link) {
        window.open(shipment.tracking_link, "_blank", "noopener,noreferrer")
      }
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [shipment])

  const saveTitle = async () => {
    if (!shipment) return
    setSaving(true)
    const updated = await updateShipment(shipment.id, { title: titleDraft })
    setShipment(prev => prev ? { ...prev, title: updated.title } : prev)
    setEditingTitle(false)
    setSaving(false)
  }

  const saveState = async () => {
    if (!shipment) return
    setSaving(true)
    const updated = await updateShipment(shipment.id, {
      current_state: stateSelect,
      notes: notes || undefined,
    })
    setShipment(prev => prev ? { ...prev, current_state: updated.current_state } : prev)
    setNotes("")
    setSaving(false)
    await load()
  }

  const handleDelete = async () => {
    if (!shipment) return
    await deleteShipment(shipment.id)
    navigate("/")
  }

  const handleArchiveToggle = async () => {
    if (!shipment) return
    const isArchived = shipment.archived === 1
    await archiveShipment(shipment.id, !isArchived)
    if (!isArchived) {
      navigate("/")
    } else {
      await load()
    }
  }

  const handleScrapeNow = async () => {
    if (!shipment) return
    setScraping(true)
    setScrapeResult(null)
    try {
      const resp = await fetch(`/api/shipments/${shipment.id}/scrape`, { method: "POST" })
      const data = await resp.json()
      if (data.error) {
        setScrapeResult(data.error)
      } else {
        setScrapeResult(data.state_changed ? "Status updated!" : "No change")
        await load()
      }
    } catch {
      setScrapeResult("Request failed")
    }
    setScraping(false)
    setTimeout(() => setScrapeResult(null), 3000)
  }

  const handleToggleScrape = async (enabled: boolean) => {
    if (!shipment) return
    await fetch(`/api/shipments/${shipment.id}/scrape`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    })
    await load()
  }

  if (loading || !shipment) {
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-4">
        <div className="h-8 w-24 rounded bg-muted animate-pulse" />
        <div className="h-40 rounded-xl bg-muted animate-pulse" />
        <div className="h-56 rounded-xl bg-muted animate-pulse" />
      </div>
    )
  }

  const isDelivered = shipment.current_state === "delivered"

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
      {showDelete && (
        <DeleteDialog onConfirm={handleDelete} onCancel={() => setShowDelete(false)} />
      )}

      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <Link
          to="/"
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Back to Dashboard"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
        <div className="flex items-center gap-2">
          {shipment.tracking_link && (
            <Button variant="outline" size="sm" asChild>
              <a
                href={shipment.tracking_link}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5"
                title="Track package (t)"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Track
              </a>
            </Button>
          )}
          <Button
            variant="outline"
            size="icon"
            onClick={handleArchiveToggle}
            aria-label={shipment.archived ? "Unarchive shipment" : "Archive shipment"}
            title={shipment.archived ? "Unarchive" : "Archive"}
          >
            {shipment.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setShowDelete(true)}
            aria-label="Delete shipment"
            className="text-destructive hover:bg-destructive hover:text-destructive-foreground"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Title + state */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              {editingTitle ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={titleDraft}
                    onChange={e => setTitleDraft(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter") saveTitle()
                      if (e.key === "Escape") setEditingTitle(false)
                    }}
                    autoFocus
                    className="h-8 text-base font-semibold"
                  />
                  <Button size="sm" onClick={saveTitle} disabled={saving}>
                    <Save className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingTitle(false)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <CardTitle className="text-lg">
                    {shipment.title || `Shipment #${shipment.id}`}
                  </CardTitle>
                  <button
                    onClick={() => { setTitleDraft(shipment.title || ""); setEditingTitle(true) }}
                    className="text-muted-foreground hover:text-foreground transition-colors opacity-40 hover:opacity-100 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                    aria-label="Edit title"
                    title="Edit title"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
            <StateBadge state={shipment.current_state} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Progress stepper */}
          <ProgressStepper state={shipment.current_state} />

          {/* Metadata grid */}
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2">
            <MetaRow label="Carrier">
              <div className="flex items-center gap-1.5">
                <CarrierIcon carrier={shipment.carrier} size={18} />
                <span>{shipment.carrier ?? "—"}</span>
              </div>
            </MetaRow>
            <MetaRow label="Order Number" value={shipment.order_number} />
            <MetaRow label="First Seen" value={smartDate(shipment.first_seen_at)} />
            <MetaRow label="Last carrier update" value={smartDate(shipment.last_updated_at)} />
            {shipment.estimated_delivery && (() => {
              const label = etaLabel(shipment.estimated_delivery)
              const isArrivingSoon = label === "Arriving today" || label === "Arriving tomorrow"
              return (
                <div>
                  <dt className="text-xs text-muted-foreground">Estimated Delivery</dt>
                  <dd className={cn(
                    "text-sm font-medium mt-0.5",
                    isArrivingSoon ? "text-amber-600 dark:text-amber-400" : undefined
                  )}>
                    {label || smartDate(shipment.estimated_delivery)}
                  </dd>
                </div>
              )
            })()}
            {shipment.tracking_number && (
              <div className="col-span-2">
                <dt className="text-xs text-muted-foreground">Tracking Number</dt>
                <dd className="flex items-center gap-1 mt-0.5">
                  <code className="text-sm font-mono select-all">
                    {shipment.tracking_number}
                  </code>
                  <CopyTrackingButton text={shipment.tracking_number} />
                </dd>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>

      {/* Archived badge */}
      {shipment.archived === 1 && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Archive className="h-4 w-4" />
          <span>This shipment is archived.</span>
          <button onClick={handleArchiveToggle} className="text-primary hover:underline text-xs">Unarchive</button>
        </div>
      )}

      {/* Tracking retention note (delivered only) */}
      {isDelivered && (shipment as any).tracking_expires_at && (() => {
        const expiresAt = new Date((shipment as any).tracking_expires_at)
        const now = new Date()
        const diffDays = Math.round((expiresAt.getTime() - now.getTime()) / 86400000)
        if (diffDays < 0) {
          return (
            <p className="text-xs text-muted-foreground">
              Tracking data may no longer be available from carrier (expired {Math.abs(diffDays)} day{Math.abs(diffDays) !== 1 ? "s" : ""} ago).
            </p>
          )
        }
        if (diffDays <= 7) {
          return (
            <p className="text-xs text-amber-600">
              Tracking data expires in {diffDays} day{diffDays !== 1 ? "s" : ""}.
            </p>
          )
        }
        return null
      })()}

      {/* Source & sync card (merged: stall warning + scraper controls + scrape log) */}
      {shipment.scrape_enabled !== undefined && (
        <Card className={shipment.stalled ? "border-amber-300 dark:border-amber-700" : undefined}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Source &amp; sync</CardTitle>
              <div className="flex items-center gap-2">
                {shipment.scrape_enabled ? (
                  <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200 text-xs">
                    Active
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-xs">Disabled</Badge>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Stall warning inline */}
            {shipment.stalled && (
              <div className="flex items-start gap-2 text-amber-700 dark:text-amber-400 text-sm">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-medium">No further updates expected</p>
                  {shipment.stall_reason === "scrape_failures" && (
                    <p className="text-muted-foreground text-xs">
                      Scraping was disabled after {shipment.scrape_fail_count} consecutive failures.
                      {shipment.last_scraped_at ? ` Last attempt: ${smartDate(shipment.last_scraped_at as string)}.` : ""}
                    </p>
                  )}
                  {shipment.stall_reason === "retention_expired" && (
                    <p className="text-muted-foreground text-xs">
                      The carrier's tracking data retention window has been exceeded.
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Stats grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
              <div>
                <span className="text-xs text-muted-foreground block">Fail count</span>
                <span className="font-medium">{shipment.scrape_fail_count ?? 0}</span>
              </div>
              {shipment.last_scraped_at && (
                <div>
                  <span className="text-xs text-muted-foreground block">Last sync</span>
                  <span className="font-medium">{smartDate(shipment.last_scraped_at as string)}</span>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-1">
              <Button
                size="sm"
                variant="outline"
                onClick={handleScrapeNow}
                disabled={scraping}
                className="gap-1.5"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", scraping && "animate-spin")} />
                {scraping ? "Scraping…" : "Scrape Now"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleToggleScrape(!shipment.scrape_enabled)}
              >
                {shipment.scrape_enabled ? "Disable" : "Enable"}
              </Button>
              {shipment.stall_reason === "scrape_failures" && shipment.stalled && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    await fetch(`/api/shipments/${shipment.id}/scrape`, {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ enabled: true }),
                    })
                    await load()
                  }}
                >
                  Re-enable
                </Button>
              )}
              {scrapeResult && (
                <span className="text-xs text-muted-foreground">{scrapeResult}</span>
              )}
            </div>

            {/* Collapsible scrape log */}
            <div className="pt-1 border-t border-border">
              <button
                onClick={() => setScrapeLogOpen(!scrapeLogOpen)}
                className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors w-full text-left"
                aria-expanded={scrapeLogOpen}
              >
                <ChevronDown className={cn("h-4 w-4 transition-transform", scrapeLogOpen && "rotate-180")} />
                Scrape Log
              </button>
              {scrapeLogOpen && (
                <div className="mt-3">
                  {scrapeLog.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No scrape log entries yet.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-border">
                            <th className="text-left py-1.5 pr-3 font-medium text-muted-foreground">Time</th>
                            <th className="text-left py-1.5 pr-3 font-medium text-muted-foreground">Status</th>
                            <th className="text-left py-1.5 pr-3 font-medium text-muted-foreground">Duration</th>
                            <th className="text-left py-1.5 font-medium text-muted-foreground">Message</th>
                          </tr>
                        </thead>
                        <tbody>
                          {scrapeLog.map(entry => (
                            <tr key={entry.id} className="border-b border-border last:border-0">
                              <td className="py-1.5 pr-3 text-muted-foreground whitespace-nowrap">
                                {smartDate(entry.occurred_at)}
                              </td>
                              <td className="py-1.5 pr-3">
                                <ScrapeStatusIcon status={entry.status} />
                              </td>
                              <td className="py-1.5 pr-3 text-muted-foreground whitespace-nowrap">
                                {entry.duration_ms != null ? `${entry.duration_ms}ms` : "-"}
                              </td>
                              <td className="py-1.5 text-muted-foreground truncate max-w-[200px]" title={entry.message ?? undefined}>
                                {entry.message ?? "-"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* State update — hidden for archived shipments */}
      {!isDelivered && shipment.archived !== 1 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Update Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Select.Root value={stateSelect} onValueChange={setStateSelect}>
              <Select.Trigger className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring">
                <Select.Value />
                <Select.Icon><ChevronDown className="h-4 w-4 opacity-50" /></Select.Icon>
              </Select.Trigger>
              <Select.Portal>
                <Select.Content className="z-50 min-w-[8rem] overflow-hidden rounded-md border border-border bg-card shadow-md">
                  <Select.Viewport className="p-1">
                    {STATES.map(s => (
                      <Select.Item
                        key={s}
                        value={s}
                        className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent data-[highlighted]:bg-accent"
                      >
                        <Select.ItemText>{STATE_LABELS[s]}</Select.ItemText>
                      </Select.Item>
                    ))}
                  </Select.Viewport>
                </Select.Content>
              </Select.Portal>
            </Select.Root>
            <Input
              placeholder="Optional notes…"
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
            <Button onClick={saveState} disabled={saving || stateSelect === shipment.current_state}>
              {saving ? "Saving…" : "Update Status"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Event history */}
      {shipment.events && shipment.events.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Event History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 pr-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide">State</th>
                    <th className="text-left py-2 pr-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide">When</th>
                    <th className="text-left py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Notes</th>
                    <th className="text-left py-2 pl-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {[...shipment.events].reverse().map(ev => (
                    <EventRow key={ev.id} event={ev} />
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
