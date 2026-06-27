import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { fetchScrapeLog, fetchShipments, type ScrapeLogEntry, type Shipment } from "@/lib/api"

interface ScraperInfo {
  carrier: string
  name: string
  enabled: boolean
  configured: boolean
}

interface ScrapersResponse {
  scrapers: ScraperInfo[]
  scheduler_running: boolean
  last_cycle_at: string | null
}

const BASE = ""

export default function Settings() {
  const [, setSettings] = useState<Record<string, string>>({})
  const [scraperStatus, setScraperStatus] = useState<ScrapersResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Form state
  const [dhlEnabled, setDhlEnabled] = useState(true)
  const [dhlApiKey, setDhlApiKey] = useState("")
  const [dhlInterval, setDhlInterval] = useState("120")
  const [recentLog, setRecentLog] = useState<ScrapeLogEntry[]>([])
  const [shipmentMap, setShipmentMap] = useState<Record<number, Shipment>>({})

  useEffect(() => {
    Promise.all([
      fetch(`${BASE}/api/settings`).then(r => r.json()),
      fetch(`${BASE}/api/scrapers`).then(r => r.json()),
      fetchScrapeLog({ carrier: "dhl", limit: 30 }),
      fetchShipments(),
    ]).then(([settingsData, scrapersData, logData, shipmentsData]) => {
      setSettings(settingsData)
      setScraperStatus(scrapersData)
      setDhlEnabled(settingsData.scraper_dhl_enabled === "true")
      setDhlApiKey(settingsData.scraper_dhl_api_key || "")
      setDhlInterval(settingsData.scraper_dhl_interval_minutes || "60")
      setRecentLog(logData)
      const map: Record<number, Shipment> = {}
      for (const s of shipmentsData) map[s.id] = s
      setShipmentMap(map)
      setLoading(false)
    })
  }, [])

  const handleSave = async () => {
    setSaving(true)
    const payload = {
      scraper_dhl_enabled: dhlEnabled ? "true" : "false",
      scraper_dhl_api_key: dhlApiKey,
      scraper_dhl_interval_minutes: dhlInterval,
    }
    const resp = await fetch(`${BASE}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    const updated = await resp.json()
    setSettings(updated)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (loading) {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-4">
        <div className="h-8 w-32 rounded bg-muted animate-pulse" />
        <div className="h-64 rounded-xl bg-muted animate-pulse" />
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-5">
      <h1 className="text-2xl font-bold">Settings</h1>

      {/* DHL Scraper section */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">DHL Scraper</CardTitle>
            <div className="flex items-center gap-2">
              {scraperStatus?.scheduler_running && (
                <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-300">
                  Scheduler Running
                </Badge>
              )}
              {dhlEnabled ? (
                <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                  Enabled
                </Badge>
              ) : (
                <Badge variant="secondary">Disabled</Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Enable/Disable toggle */}
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Enable DHL Scraping</label>
            <button
              onClick={() => setDhlEnabled(!dhlEnabled)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                dhlEnabled ? "bg-primary" : "bg-muted"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  dhlEnabled ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>

          {/* API Key */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">API Key</label>
            <Input
              type="password"
              placeholder="Enter DHL API key..."
              value={dhlApiKey}
              onChange={e => setDhlApiKey(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Get your API key from the DHL Developer Portal
            </p>
          </div>

          {/* Interval */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Check Interval (minutes)</label>
            <Input
              type="number"
              min="10"
              max="1440"
              value={dhlInterval}
              onChange={e => setDhlInterval(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              How often to check for status updates. Minimum 10 min, default 120 min. DHL allows 250 calls/day (10 packages × 24 checks = 240/day at 60min)
            </p>
          </div>

          {/* Status info */}
          {scraperStatus?.last_cycle_at && (
            <div className="text-xs text-muted-foreground pt-2 border-t border-border">
              Last scrape cycle: {new Date(scraperStatus.last_cycle_at).toLocaleString()}
            </div>
          )}

          {/* Save button */}
          <div className="flex items-center gap-3 pt-2">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save Settings"}
            </Button>
            {saved && (
              <span className="text-sm text-emerald-600">Settings saved!</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Available Scrapers */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Available Scrapers</CardTitle>
        </CardHeader>
        <CardContent>
          {scraperStatus?.scrapers && scraperStatus.scrapers.length > 0 ? (
            <div className="space-y-2">
              {scraperStatus.scrapers.map(s => (
                <div key={s.carrier} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <div>
                    <span className="text-sm font-medium">{s.name}</span>
                    <span className="text-xs text-muted-foreground ml-2">({s.carrier})</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {s.configured ? (
                      <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-300">
                        Configured
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                        Not Configured
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No scrapers registered</p>
          )}
        </CardContent>
      </Card>

      {/* Recent Scrape Activity */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent Scrape Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {recentLog.length === 0 ? (
            <p className="text-xs text-muted-foreground">No scrape activity recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-1.5 pr-3 font-medium text-muted-foreground">Time</th>
                    <th className="text-left py-1.5 pr-3 font-medium text-muted-foreground">Shipment</th>
                    <th className="text-left py-1.5 pr-3 font-medium text-muted-foreground">Status</th>
                    <th className="text-left py-1.5 pr-3 font-medium text-muted-foreground">Duration</th>
                    <th className="text-left py-1.5 font-medium text-muted-foreground">Message</th>
                  </tr>
                </thead>
                <tbody>
                  {recentLog.map(entry => {
                    const ship = shipmentMap[entry.shipment_id]
                    return (
                      <tr key={entry.id} className="border-b border-border last:border-0">
                        <td className="py-1.5 pr-3 text-muted-foreground whitespace-nowrap">
                          {entry.occurred_at ? new Date(entry.occurred_at).toLocaleString() : "-"}
                        </td>
                        <td className="py-1.5 pr-3 whitespace-nowrap">
                          <Link
                            to={`/shipments/${entry.shipment_id}`}
                            className="text-primary hover:underline"
                          >
                            {ship?.title || `#${entry.shipment_id}`}
                          </Link>
                        </td>
                        <td className="py-1.5 pr-3">
                          <SettingsScrapeStatusIcon status={entry.status} />
                        </td>
                        <td className="py-1.5 pr-3 text-muted-foreground whitespace-nowrap">
                          {entry.duration_ms != null ? `${entry.duration_ms}ms` : "-"}
                        </td>
                        <td className="py-1.5 text-muted-foreground truncate max-w-[200px]" title={entry.message ?? undefined}>
                          {entry.message ?? "-"}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function SettingsScrapeStatusIcon({ status }: { status: string }) {
  switch (status) {
    case "success":
      return <span className="text-emerald-600" title="Success">{"✓"}</span>
    case "no_change":
      return <span className="text-muted-foreground" title="No change">{"—"}</span>
    case "error":
      return <span className="text-red-600" title="Error">{"✗"}</span>
    case "timeout":
      return <span className="text-amber-600" title="Timeout">{"⏱"}</span>
    case "disabled":
      return <span className="text-red-600" title="Disabled">{"⛔"}</span>
    default:
      return <span className="text-muted-foreground">?</span>
  }
}
