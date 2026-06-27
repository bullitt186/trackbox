import { useEffect, useState } from 'react'

interface Shipment {
  id: number
  title: string | null
  tracking_number: string | null
  carrier: string | null
  current_state: string
  tracking_link: string | null
  last_updated_at: string | null
}

export default function App() {
  const [shipments, setShipments] = useState<Shipment[]>([])

  useEffect(() => {
    fetch('/api/shipments').then(r => r.json()).then(setShipments)
  }, [])

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6 bg-gradient-to-r from-blue-500 to-green-500 bg-clip-text text-transparent">
        Trackbox
      </h1>
      <p className="text-sm text-gray-500 mb-4">{shipments.length} shipments</p>
      <div className="space-y-3">
        {shipments.map(s => (
          <div key={s.id} className="p-4 rounded-lg border border-gray-200 dark:border-gray-700 hover:shadow-md transition-shadow">
            <div className="flex justify-between items-center">
              <span className="font-medium">{s.title || `Shipment #${s.id}`}</span>
              <span className="text-xs px-2 py-1 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200">
                {s.current_state.replace('_', ' ')}
              </span>
            </div>
            {s.carrier && <p className="text-sm text-gray-500 mt-1">{s.carrier}</p>}
          </div>
        ))}
      </div>
    </div>
  )
}
