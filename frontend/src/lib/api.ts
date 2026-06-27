import type { ShipmentState } from "@/types/shipment"

const BASE = ""

export interface Shipment {
  id: number
  title: string | null
  tracking_number: string | null
  order_number: string | null
  carrier: string | null
  tracking_link: string | null
  current_state: ShipmentState
  first_seen_at: string | null
  last_updated_at: string | null
  last_event?: { state: ShipmentState; notes: string | null; occurred_at: string | null } | null
  events?: ShipmentEvent[]
  scrape_enabled?: number
  scrape_fail_count?: number
  last_scraped_at?: string | null
  archived?: number
  stalled?: boolean
}

export interface ShipmentEvent {
  id: number
  shipment_id: number
  state: string
  notes: string | null
  source: string
  occurred_at: string | null
}

export interface Parser {
  id: number
  sender_domain: string
  subject_keywords: string
  field_map: string
  created_at: string | null
  use_count: number
}

export async function fetchShipments(state?: "active" | "delivered" | "archived"): Promise<Shipment[]> {
  const url = state ? `${BASE}/api/shipments?state=${state}` : `${BASE}/api/shipments`
  return (await fetch(url)).json()
}

export async function archiveShipment(id: number, archived: boolean): Promise<Shipment> {
  return updateShipment(id, { archived: archived ? 1 : 0 })
}

export async function fetchShipment(id: number): Promise<Shipment & { events: ShipmentEvent[] }> {
  return (await fetch(`${BASE}/api/shipments/${id}`)).json()
}

export async function updateShipment(id: number, data: Record<string, unknown>): Promise<Shipment> {
  return (await fetch(`${BASE}/api/shipments/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) })).json()
}

export async function deleteShipment(id: number): Promise<void> {
  await fetch(`${BASE}/api/shipments/${id}`, { method: "DELETE" })
}

export async function fetchParsers(): Promise<Parser[]> {
  return (await fetch(`${BASE}/api/parsers`)).json()
}

export async function deleteParser(id: number): Promise<void> {
  await fetch(`${BASE}/api/parsers/${id}`, { method: "DELETE" })
}

export async function fetchHealth(): Promise<{ status: string; version: string; build_time: string; uptime_seconds: number }> {
  return (await fetch(`${BASE}/health`)).json()
}

export interface ScrapeLogEntry {
  id: number
  shipment_id: number
  carrier: string | null
  tracking_number: string | null
  status: string  // "success", "no_change", "error", "timeout", "disabled"
  state_before: string | null
  state_after: string | null
  message: string | null
  duration_ms: number | null
  occurred_at: string | null
}

export async function fetchScrapeLog(params?: { shipment_id?: number; carrier?: string; status?: string; limit?: number }): Promise<ScrapeLogEntry[]> {
  const q = new URLSearchParams()
  if (params?.shipment_id) q.set("shipment_id", String(params.shipment_id))
  if (params?.carrier) q.set("carrier", params.carrier)
  if (params?.status) q.set("status", params.status)
  if (params?.limit) q.set("limit", String(params.limit))
  return (await fetch(`${BASE}/api/scrape-log?${q}`)).json()
}
