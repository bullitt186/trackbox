export type ShipmentState = 'unknown' | 'preparing' | 'shipped' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'delayed' | 'exception'

export interface ShipmentEvent {
  id: number
  shipment_id: number
  state: ShipmentState
  notes: string | null
  source: 'email' | 'manual'
  occurred_at: string | null
  message_id: string | null
}

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
  events?: ShipmentEvent[]
  last_event?: ShipmentEvent | null
}

export interface Parser {
  id: number
  sender_domain: string
  subject_keywords: string
  field_map: string
  created_at: string | null
  use_count: number
}

export interface Stats {
  shipments_by_state: Record<ShipmentState, number>
  total_parsers: number
  total_events: number
}
