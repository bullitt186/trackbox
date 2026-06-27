const BASE = ''

export async function fetchShipments(state?: 'active' | 'delivered'): Promise<any[]> {
  const url = state ? `${BASE}/api/shipments?state=${state}` : `${BASE}/api/shipments`
  const res = await fetch(url)
  return res.json()
}

export async function fetchShipment(id: number): Promise<any> {
  const res = await fetch(`${BASE}/api/shipments/${id}`)
  return res.json()
}

export async function updateShipment(id: number, data: Record<string, any>): Promise<any> {
  const res = await fetch(`${BASE}/api/shipments/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  return res.json()
}

export async function deleteShipment(id: number): Promise<void> {
  await fetch(`${BASE}/api/shipments/${id}`, { method: 'DELETE' })
}

export async function fetchStats(): Promise<any> {
  const res = await fetch(`${BASE}/api/stats`)
  return res.json()
}

export async function fetchParsers(): Promise<any[]> {
  const res = await fetch(`${BASE}/api/parsers`)
  return res.json()
}

export async function deleteParser(id: number): Promise<void> {
  await fetch(`${BASE}/api/parsers/${id}`, { method: 'DELETE' })
}
