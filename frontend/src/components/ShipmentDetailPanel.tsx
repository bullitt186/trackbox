import React, { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { X, Copy, ExternalLink, MoreHorizontal, Calendar, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { fetchShipment, type Shipment, type ShipmentEvent } from "@/lib/api"
import { StateBadge } from "@/components/StateBadge"
import { getCarrierIcon, getCarrierDisplay } from "@/lib/carrier"
import { STATE_LABELS } from "@/lib/utils"

interface Props {
  id: number
  onClose: () => void
  onRefresh?: () => void  // ponytail: reserved for archive-from-panel, not wired yet
}

const STEP_STATES = ["preparing", "shipped", "in_transit", "out_for_delivery", "delivered"] as const
const STEP_LABELS = ["Preparing", "Shipped", "In transit", "Out for delivery", "Delivered"]

function getStepIndex(state: string): number {
  const idx = STEP_STATES.indexOf(state as (typeof STEP_STATES)[number])
  if (idx >= 0) return idx
  if (state === "delayed" || state === "exception") return 2
  return 0
}

function formatShortDateTime(dateStr: string | null): string {
  if (!dateStr) return "—"
  const d = new Date(dateStr)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today.getTime() - 86400000)
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  if (d >= today) return `Today, ${time}`
  if (d >= yesterday) return `Yesterday, ${time}`
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + `, ${time}`
}

function formatDeliveryDate(dateStr: string | null | undefined): { date: string; relative: string } | null {
  if (!dateStr) return null
  const d = new Date(dateStr + "T00:00:00")
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000)
  const date = d.toLocaleDateString("en-GB", { month: "short", day: "numeric", year: "numeric" })
  const relative = diff < 0 ? "overdue" : diff === 0 ? "today" : diff === 1 ? "tomorrow" : `in ${diff} days`
  return { date, relative }
}

export function ShipmentDetailPanel({ id, onClose }: Props) {
  const navigate = useNavigate()
  const [detail, setDetail] = useState<(Shipment & { events: ShipmentEvent[] }) | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setDetail(null)
    fetchShipment(id).then(setDetail)
  }, [id])

  if (!detail) {
    return (
      <div className="w-[360px] shrink-0 border-l border-border bg-background flex items-center justify-center py-16 text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }

  const carrierIcon = getCarrierIcon(detail.carrier)
  const carrierDisplay = getCarrierDisplay(detail.carrier)
  const stepIndex = getStepIndex(detail.current_state)
  const delivery = formatDeliveryDate(detail.estimated_delivery)
  const events = detail.events ?? []

  function copyTracking() {
    if (!detail!.tracking_number) return
    navigator.clipboard.writeText(detail!.tracking_number)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="w-[360px] shrink-0 border-l border-border/50 bg-background overflow-y-auto max-h-screen">
      {/* Header: tracking number */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
        <span className="font-mono font-semibold text-sm tracking-wide">{detail.tracking_number ?? "—"}</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground ml-2 shrink-0">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Carrier + status */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
        <div className="flex items-center gap-2">
          {carrierIcon
            ? <img src={carrierIcon} className="h-7 w-7 object-contain shrink-0" alt="" />
            : <span className="text-base shrink-0">📦</span>
          }
          <span className="text-sm font-medium">{carrierDisplay?.name ?? detail.carrier ?? "Unknown"}</span>
        </div>
        {/* ponytail: status dropdown is visual-only */}
        <div className="flex items-center gap-1">
          <StateBadge state={detail.current_state} />
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
      </div>

      {/* Quick actions */}
      <div className="flex border-b border-border/50">
        <button
          onClick={copyTracking}
          className="flex-1 flex flex-col items-center gap-1 py-3 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <Copy className="h-4 w-4" />
          <span>{copied ? "Copied!" : "Copy tracking number"}</span>
        </button>
        {detail.tracking_link && (
          <button
            onClick={() => window.open(detail.tracking_link!, "_blank")}
            className="flex-1 flex flex-col items-center gap-1 py-3 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors border-l border-border/30"
          >
            <ExternalLink className="h-4 w-4" />
            <span>Track on carrier site</span>
          </button>
        )}
        <button className="flex-1 flex flex-col items-center gap-1 py-3 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors border-l border-border/30">
          <MoreHorizontal className="h-4 w-4" />
          <span>More actions</span>
        </button>
      </div>

      <div className="p-4 space-y-5">
        {/* Estimated delivery */}
        {delivery && (
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-2">Estimated delivery</div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm font-medium">{delivery.date}</span>
              </div>
              <span className="text-xs text-muted-foreground">{delivery.relative}</span>
            </div>
          </div>
        )}

        {/* Status progress stepper */}
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-2.5">Status</div>
          <div className="flex items-center">
            {STEP_STATES.map((s, i) => (
              <React.Fragment key={s}>
                {i > 0 && (
                  <div className={cn("h-0.5 flex-1", i <= stepIndex ? "bg-primary" : "bg-border")} />
                )}
                <div
                  title={STEP_LABELS[i]}
                  className={cn(
                    "w-2.5 h-2.5 rounded-full shrink-0 ring-2",
                    i <= stepIndex
                      ? "bg-primary ring-primary"
                      : "bg-background ring-border"
                  )}
                />
              </React.Fragment>
            ))}
          </div>
          <div className="flex justify-between mt-1.5">
            <span className="text-[10px] text-muted-foreground">Preparing</span>
            <span className="text-[10px] text-muted-foreground">Delivered</span>
          </div>
        </div>

        {/* Latest update */}
        {events[0] && (
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1.5">Latest update</div>
            <div className="text-sm font-medium leading-snug">
              {events[0].notes ?? STATE_LABELS[events[0].state] ?? events[0].state}
            </div>
            <div className="text-xs text-muted-foreground mt-1">{formatShortDateTime(events[0].occurred_at)}</div>
          </div>
        )}

        {/* Tracking events */}
        {events.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-medium text-muted-foreground">Tracking events</div>
              <button
                onClick={() => navigate(`/shipments/${id}`)}
                className="text-xs text-primary hover:underline"
              >
                View all
              </button>
            </div>
            <div className="space-y-3">
              {events.slice(0, 4).map((ev, i) => (
                <div key={ev.id} className="flex items-start gap-2.5">
                  <div className={cn(
                    "w-2 h-2 rounded-full mt-1 shrink-0",
                    i === 0 ? "bg-primary" : "bg-muted-foreground/25"
                  )} />
                  <div className="min-w-0">
                    <div className="text-xs leading-snug">{ev.notes ?? STATE_LABELS[ev.state] ?? ev.state}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{formatShortDateTime(ev.occurred_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Metadata */}
        <div className="border-t border-border/40 pt-4 space-y-2">
          {([
            ["Shipment type", "Package"],
            ["Weight", "—"],
            ["References", detail.order_number ?? "—"],
            ["Added on", detail.first_seen_at
              ? new Date(detail.first_seen_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
              : "—"],
          ] as const).map(([label, value]) => (
            <div key={label} className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{label}</span>
              <span className="font-medium">{value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
