import type { Shipment } from '@/types/shipment'
import { STATE_LABELS, relativeTime } from '@/lib/utils'

interface Props {
  shipment: Shipment
  onClick?: () => void
}

export function ShipmentCard({ shipment, onClick }: Props) {
  return (
    <div
      onClick={onClick}
      className="p-4 rounded-lg border border-gray-200 dark:border-gray-700 hover:shadow-md transition-all cursor-pointer"
    >
      <div className="flex justify-between items-start">
        <div>
          <span className="font-medium">{shipment.title || `Shipment #${shipment.id}`}</span>
          {shipment.tracking_number && (
            <p className="text-xs text-gray-500 font-mono mt-0.5">{shipment.tracking_number}</p>
          )}
        </div>
        <span className={`text-xs px-2 py-1 rounded-full font-semibold uppercase tracking-wide state-${shipment.current_state}`}>
          {STATE_LABELS[shipment.current_state] || shipment.current_state}
        </span>
      </div>
      <div className="flex justify-between items-center mt-2 text-sm text-gray-500">
        <span>{shipment.carrier || ''}</span>
        {shipment.last_updated_at && <span>{relativeTime(shipment.last_updated_at)}</span>}
      </div>
    </div>
  )
}
