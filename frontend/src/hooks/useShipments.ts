import { useEffect, useState } from 'react'
import { fetchShipments } from '@/lib/api'
import type { Shipment } from '@/types/shipment'

export function useShipments() {
  const [shipments, setShipments] = useState<Shipment[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = () => {
    fetchShipments().then(data => {
      setShipments(data)
      setLoading(false)
    })
  }

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 60000)
    return () => clearInterval(interval)
  }, [])

  return { shipments, loading, refresh }
}
