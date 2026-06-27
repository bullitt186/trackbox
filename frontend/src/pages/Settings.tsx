import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { fetchScrapeLog, fetchShipments, type ScrapeLogEntry, type Shipment } from "@/lib/api"

interface ScraperOption {
  key: string
  name: string
}

interface ScraperInfo {
  carrier: string
  name: string
  enabled: boolean
  configured: boolean
  default_interval_minutes: number
  max_retention_days: number
  retention_days: number
  available_scrapers: ScraperOption[]
  active_scraper: string
}

interface ScrapersResponse {
  scrapers: ScraperInfo[]
  scheduler_running: boolean
  last_cycle_at: string | null
}

interface ScraperForm {
  enabled: boolean
  interval: string
  retentionDays: string
  apiKey?: string
  activeKey: string
}

const BASE = ""

export default function Settings() {
  const [, setAllSettings] = useState<Record<string, string>>({})
  const [scraperStatus, setScraperStatus] = useState<ScrapersResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [recentLog, setRecentLog] = useState<ScrapeLogEntry[]>([])
  const [shipmentMap, setShipmentMap] = useState<Record<number, Shipment>>({})
  const [scraperForms, setScraperForms] = useState<Record<string, ScraperForm>>({})

  useEffect(() => {
    Promise.all([
      fetch(`${BASE}/api/settings`).then(r => r.json()),
      fetch(`${BASE}/api/scrapers`).then(r => r.json()),
      fetchScrapeLog({ limit: 30 }),
      fetchShipments(),
    ]).then(([settingsData, scrapersData, logData, shipmentsData]) => {
      setAllSettings(settingsData)
      setScraperStatus(scrapersData)

      const forms: Record<string, ScraperForm> = {}
      for (const s of (scrapersData as ScrapersResponse).scrapers) {
        const c = s.carrier
        forms[c] = {
          enabled: settingsData[`scraper_${c}_enabled`] === "true",
          interval: settingsData[`scraper_${c}_interval_minutes`] || String(s.default_interval_minutes),
          retentionDays: settingsData[`scraper_${c}_retention_days`] || String(s.retention_days),
          activeKey: settingsData[`scraper_${c}_active`] || s.active_scraper,
          ...(c === "dhl" ? { apiKey: settingsData.scraper_dhl_api_key || "" } : {}),
        }
      }
      setScraperForms(forms)

      setRecentLog(logData)
      const map: Record<number, Shipment> = {}
      for (const s of shipmentsData) map[s.id] = s
      setShipmentMap(map)
      setLoading(false)
    })
  }, [])

  const handleSave = async () => {
    setSaving(true)
    const payload: Record<string, string> = {}
    for (const [carrier, form] of Object.entries(scraperForms)) {
      payload[`scraper_${carrier}_enabled`] = form.enabled ? "true" : "false"
      payload[`scraper_${carrier}_interval_minutes`] = form.interval
      payload[`scraper_${carrier}_retention_days`] = form.retentionDays
      payload[`scraper_${carrier}_active`] = form.activeKey
      if (form.apiKey !== undefined) {
        payload[`scraper_${carrier}_api_key`] = form.apiKey
      }
    }
    const resp = await fetch(`${BASE}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    const updated = await resp.json()
    setAllSettings(updated)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const updateForm = (carrier: string, field: string, value: string | boolean) => {
    setScraperForms(prev => ({
      ...prev,
      [carrier]: { ...prev[carrier], [field]: value },
    }))
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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Settings</h1>
        {scraperStatus?.scheduler_running && (
          <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-300">
            Scheduler Running
          </Badge>
        )}
      </div>

      {/* Scraper Cards */}
      {scraperStatus?.scrapers.map(s => {
        const form = scraperForms[s.carrier]
        if (!form) return null
        // Active scraper name for header display
        const activeName = s.available_scrapers.find(o => o.key === form.activeKey)?.name ?? s.name
        return (
          <Card key={s.carrier}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{activeName} Scraper</CardTitle>
                <div className="flex items-center gap-2">
                  {form.enabled ? (
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
                <label className="text-sm font-medium">Enable {s.carrier.toUpperCase()} Scraping</label>
                <button
                  onClick={() => updateForm(s.carrier, "enabled", !form.enabled)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    form.enabled ? "bg-primary" : "bg-muted"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      form.enabled ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>

              {/* Tracking method selector — only when multiple scrapers available */}
              {s.available_scrapers.length > 1 && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Tracking Method</label>
                  <div className="flex flex-col gap-1.5">
                    {s.available_scrapers.map(opt => (
                      <label key={opt.key} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="radio"
                          name={`scraper_${s.carrier}_active`}
                          value={opt.key}
                          checked={form.activeKey === opt.key}
                          onChange={() => updateForm(s.carrier, "activeKey", opt.key)}
                          className="accent-primary"
                        />
                        {opt.name}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* API Key (DHL only, shown when API scraper is selected) */}
              {form.apiKey !== undefined && form.activeKey === "dhl_api" && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">API Key</label>
                  <Input
                    type="password"
                    placeholder="Enter DHL API key..."
                    value={form.apiKey}
                    onChange={e => updateForm(s.carrier, "apiKey", e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Get your API key from the DHL Developer Portal
                  </p>
                </div>
              )}

              {/* Interval */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Check Interval (minutes)</label>
                <Input
                  type="number"
                  min="10"
                  max="1440"
                  value={form.interval}
                  onChange={e => updateForm(s.carrier, "interval", e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Minimum 10 min, default {s.default_interval_minutes} min.
                  {s.carrier === "dhl" && form.activeKey === "dhl_api" && " DHL API allows 250 calls/day."}
                </p>
              </div>

              {/* Retention period */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Retention Period (days after delivery)</label>
                <Input
                  type="number"
                  min="1"
                  max={s.max_retention_days}
                  value={form.retentionDays}
                  onChange={e => updateForm(s.carrier, "retentionDays", e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {s.carrier === "dhl" && "DHL keeps tracking data for up to 90 days after delivery."}
                  {s.carrier === "hermes" && "Hermes keeps tracking data for up to 30 days after delivery."}
                  {(s.carrier === "dpd" || s.carrier === "gls") && `Retention period not publicly documented for ${s.carrier.toUpperCase()}; max set to 90 days.`}
                  {" "}Scraping stops after this many days.
                </p>
              </div>
            </CardContent>
          </Card>
        )
      })}

      {/* Save button */}
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save Settings"}
        </Button>
        {saved && (
          <span className="text-sm text-emerald-600">Settings saved!</span>
        )}
      </div>

      {/* Status info */}
      {scraperStatus?.last_cycle_at && (
        <p className="text-xs text-muted-foreground">
          Last scrape cycle: {new Date(scraperStatus.last_cycle_at).toLocaleString()}
        </p>
      )}

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
                    <th className="text-left py-1.5 pr-3 font-medium text-muted-foreground">Carrier</th>
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
                        <td className="py-1.5 pr-3 text-muted-foreground uppercase">
                          {entry.carrier || "-"}
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
