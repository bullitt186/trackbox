import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { fetchScrapeLog, fetchShipments, type ScrapeLogEntry, type Shipment } from "@/lib/api"
import { CarrierIcon } from "@/components/CarrierIcon"
import { ScrapeStatusIcon } from "@/components/ScrapeStatusIcon"
import { relativeTime } from "@/lib/utils"

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

function SectionHeader({ label, description }: { label: string; description?: string }) {
  return (
    <div className="pt-2 pb-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
    </div>
  )
}

const BASE = ""

export default function Settings() {
  const [allSettings, setAllSettings] = useState<Record<string, string>>({})
  const [scraperStatus, setScraperStatus] = useState<ScrapersResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [recentLog, setRecentLog] = useState<ScrapeLogEntry[]>([])
  const [shipmentMap, setShipmentMap] = useState<Record<number, Shipment>>({})
  const [scraperForms, setScraperForms] = useState<Record<string, ScraperForm>>({})
  const [mqttEnabled, setMqttEnabled] = useState(false)
  const [mqttTopicPrefix, setMqttTopicPrefix] = useState("trackbox")
  const [trackboxUrl, setTrackboxUrl] = useState("")

  useEffect(() => {
    Promise.all([
      fetch(`${BASE}/api/settings`).then(r => r.json()),
      fetch(`${BASE}/api/scrapers`).then(r => r.json()),
      fetchScrapeLog({ limit: 30 }),
      fetchShipments(),
      fetchShipments("archived"),
    ]).then(([settingsData, scrapersData, logData, shipmentsData, archivedData]) => {
      setAllSettings(settingsData)
      setScraperStatus(scrapersData)
      setMqttEnabled(settingsData["mqtt_enabled"] === "true")
      setMqttTopicPrefix(settingsData["mqtt_topic_prefix"] || "trackbox")
      setTrackboxUrl(settingsData["trackbox_url"] || "")

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
      for (const s of [...shipmentsData, ...archivedData]) map[s.id] = s
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
    payload["mqtt_enabled"] = mqttEnabled ? "true" : "false"
    payload["mqtt_topic_prefix"] = mqttTopicPrefix
    payload["trackbox_url"] = trackboxUrl
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
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-5 pb-24">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Settings</h1>
        {scraperStatus?.scheduler_running && (
          <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-300">
            Scheduler Running
          </Badge>
        )}
      </div>

      {/* Scrapers section */}
      <SectionHeader
        label="Scrapers"
        description="Carrier polling configuration and data retention."
      />
      {scraperStatus?.scrapers.map(s => {
        const form = scraperForms[s.carrier]
        if (!form) return null
        const activeName = s.available_scrapers.find(o => o.key === form.activeKey)?.name ?? s.name
        return (
          <Card key={s.carrier}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <CarrierIcon carrier={s.carrier} size={20} />
                  {activeName} Scraper
                </CardTitle>
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
                <label className="text-sm font-medium">Enabled</label>
                <button
                  onClick={() => updateForm(s.carrier, "enabled", !form.enabled)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    form.enabled ? "bg-primary" : "bg-muted"
                  }`}
                  aria-checked={form.enabled}
                  role="switch"
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      form.enabled ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>

              {/* Tracking method selector */}
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

              {/* API Key (DHL only) */}
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

      {/* Notifications section */}
      <SectionHeader
        label="Notifications"
        description="Push state changes to external systems via MQTT."
      />
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Notifications</CardTitle>
          <CardDescription>Publish state changes via MQTT (e.g. Home Assistant auto-discovery)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Broker credentials (host, port, user, password) are configured via environment variables
            (<code>MQTT_HOST</code>, <code>MQTT_PORT</code>, <code>MQTT_USER</code>, <code>MQTT_PASSWORD</code>).
            Restart the container after changing them.
          </p>
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Enable MQTT Publishing</label>
            <button
              onClick={() => setMqttEnabled(v => !v)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${mqttEnabled ? "bg-primary" : "bg-muted"}`}
              aria-checked={mqttEnabled}
              role="switch"
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${mqttEnabled ? "translate-x-6" : "translate-x-1"}`} />
            </button>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">MQTT Topic Prefix</label>
            <Input
              value={mqttTopicPrefix}
              onChange={e => setMqttTopicPrefix(e.target.value)}
              placeholder="trackbox"
            />
            <p className="text-xs text-muted-foreground">
              Sensors publish to <code>{mqttTopicPrefix}/sensor/&lt;id&gt;</code>.
              Autodiscovery to <code>homeassistant/sensor/trackbox_&lt;id&gt;/config</code>.
            </p>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Trackbox URL</label>
            <Input
              value={trackboxUrl}
              onChange={e => setTrackboxUrl(e.target.value)}
              placeholder="http://192.168.0.50:8900"
            />
            <p className="text-xs text-muted-foreground">
              Published as the <em>Trackbox URL</em> sensor in Home Assistant.
            </p>
          </div>
          {allSettings["mqtt_enabled"] === "true" && (
            <p className="text-xs text-emerald-600">
              MQTT is active — sensors are publishing to{" "}
              <code>{allSettings["mqtt_topic_prefix"] || "trackbox"}</code>.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Activity section */}
      <SectionHeader
        label="Activity"
        description="Recent carrier sync history."
      />
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
                          {entry.occurred_at ? relativeTime(entry.occurred_at) : "-"}
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
                          <ScrapeStatusIcon status={entry.status} />
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

      {/* Sticky save bar */}
      <div className="sticky bottom-0 -mx-4 md:-mx-6 px-4 md:px-6 py-3 bg-background/95 backdrop-blur border-t border-border flex items-center justify-between z-10">
        <p className="text-xs text-muted-foreground">
          {scraperStatus?.last_cycle_at
            ? `Last cycle: ${relativeTime(scraperStatus.last_cycle_at)}`
            : "No cycle recorded yet"}
        </p>
        <div className="flex items-center gap-3">
          {saved && <span className="text-sm text-emerald-600">Saved</span>}
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save Settings"}
          </Button>
        </div>
      </div>
    </div>
  )
}
