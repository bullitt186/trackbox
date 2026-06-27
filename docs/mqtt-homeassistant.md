# MQTT / Home Assistant Integration Guide

Trackbox publishes shipment state to an MQTT broker as 13 Home Assistant autodiscovery sensors. Once configured, HA will automatically create a "Trackbox" device with count sensors for each shipment state and attribute payloads listing individual shipments.

## Prerequisites

- An MQTT broker (Mosquitto, EMQX, or any HA-compatible broker)
- Home Assistant with the MQTT integration enabled
- Trackbox accessible by hostname or IP

## Configuration

### Step 1: Set environment variables

Add these to your `.env` before starting the container:

```dotenv
MQTT_HOST=homeassistant.local     # or broker IP
MQTT_PORT=1883                    # default
MQTT_USER=trackbox                # leave empty if no auth
MQTT_PASSWORD=secret
MQTT_TOPIC_PREFIX=trackbox        # optional, change for multiple instances
```

Restart the container after adding these variables.

### Step 2: Enable MQTT in Settings UI

After the container starts:

1. Open Trackbox in your browser.
2. Navigate to Settings.
3. Find the MQTT section and toggle "MQTT Enabled" to on.
4. Optionally change the topic prefix (must match `MQTT_TOPIC_PREFIX` or override it here).

Both steps are required. Setting `MQTT_HOST` without enabling in Settings does not connect.

### Step 3: Verify in Home Assistant

Within a few seconds of enabling MQTT, Trackbox connects to the broker and publishes autodiscovery messages. In Home Assistant:

1. Go to Settings → Devices & Services → MQTT.
2. A new device named "Trackbox" should appear with 13 entities.

If the device does not appear, check [Troubleshooting](#troubleshooting).

## Topic structure

All topics are prefixed with the configured topic prefix (default: `trackbox`).

| Topic | Payload | Description |
|-------|---------|-------------|
| `trackbox/status` | `online` / `offline` | Last Will and Testament (LWT) topic. `online` on connect, `offline` on graceful disconnect or unexpected drop. |
| `trackbox/sensor/{uid}` | integer or string | Current value for each sensor. |
| `trackbox/sensor/{uid}/attributes` | JSON | Attribute payload with shipment list (count sensors only). |

Autodiscovery messages are published to:
```
homeassistant/sensor/trackbox_{uid}/config
```

All state and attribute messages are published with `retain=true`, so HA picks up the latest values on restart.

## Sensors

### Count sensors (with attributes)

These 11 sensors publish an integer value. Each also has an `/attributes` topic with a JSON object listing the individual shipments in that group.

| Sensor name | UID | Value | Icon |
|-------------|-----|-------|------|
| Trackbox Total Shipments | `total` | Count of all non-archived shipments | `mdi:package-variant` |
| Trackbox Active Shipments | `active` | Non-delivered, non-archived | `mdi:truck-delivery` |
| Trackbox Delivered Shipments | `delivered` | Delivered, non-archived | `mdi:package-check` |
| Trackbox Archived Shipments | `archived` | All archived shipments | `mdi:archive` |
| Trackbox Stalled Shipments | `stalled` | Active with 3+ scrape failures or scraping disabled | `mdi:truck-alert` |
| Trackbox Preparing | `preparing` | Active in `preparing` state | `mdi:package-variant-closed` |
| Trackbox Shipped | `shipped` | Active in `shipped` state | `mdi:shipping-pallet` |
| Trackbox In Transit | `in_transit` | Active in `in_transit` state | `mdi:truck` |
| Trackbox Out for Delivery | `out_for_delivery` | Active in `out_for_delivery` state | `mdi:truck-fast` |
| Trackbox Delayed | `delayed` | Active in `delayed` state | `mdi:truck-remove` |
| Trackbox Exception | `exception` | Active in `exception` state | `mdi:truck-alert-outline` |

### String sensors (no attributes)

| Sensor name | UID | Value | Icon |
|-------------|-----|-------|------|
| Trackbox Version | `version` | App version string (e.g. `1.2.3`) | `mdi:information` |
| Trackbox URL | `url` | Configured Trackbox URL | `mdi:web` |

## Attribute payload format

Count sensors include a JSON attributes payload at `trackbox/sensor/{uid}/attributes`:

```json
{
  "items": [
    {
      "id": 42,
      "name": "Wireless Keyboard",
      "carrier": "DHL",
      "status": "in_transit",
      "tracking_number": "1234567890",
      "tracking_url": "https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode=1234567890",
      "started": "2026-01-20T10:00:00Z",
      "last_updated": "2026-01-25T14:30:00Z"
    }
  ]
}
```

The `items` list contains only shipments belonging to that sensor's group. For example, `trackbox/sensor/in_transit/attributes` contains only shipments currently in transit.

**Size warning:** If you have many active shipments, the `active` sensor's attributes payload may exceed Home Assistant's ~16 KB attribute size limit. Trackbox logs a warning when this threshold is reached. Archive completed shipments to keep the payload size manageable.

## Heartbeat

Trackbox publishes a full state update every 15 minutes, even when no shipment state changes occur. This keeps all sensor values fresh in HA after a broker restart. The heartbeat re-publishes all state topics but does not publish the autodiscovery config again.

## Using Trackbox sensors in HA automations

### Notify when a shipment is out for delivery

```yaml
alias: Parcel out for delivery
trigger:
  - platform: state
    entity_id: sensor.trackbox_out_for_delivery
    from: "0"
action:
  - service: notify.mobile_app_your_phone
    data:
      title: Delivery today
      message: >
        {{ trigger.to_state.attributes.items | map(attribute='name') | join(', ') }}
        is out for delivery.
```

### Dashboard card showing active shipments

```yaml
type: entities
title: Active Shipments
entities:
  - entity: sensor.trackbox_active
  - entity: sensor.trackbox_in_transit
  - entity: sensor.trackbox_out_for_delivery
  - entity: sensor.trackbox_delayed
```

### Markdown card with shipment list

```yaml
type: markdown
title: In Transit
content: >
  {% for item in states.sensor.trackbox_in_transit.attributes.items %}
  - **{{ item.name }}** ({{ item.carrier }}) — [Track]({{ item.tracking_url }})
  {% else %}
  No shipments in transit.
  {% endfor %}
```

## Troubleshooting

**Trackbox device does not appear in HA:**
1. Check that MQTT is enabled in both the env (`MQTT_HOST` set) and the Settings UI.
2. In HA, go to Settings → Devices & Services → MQTT → Configure and press "Re-fetch MQTT subscriptions".
3. Check Trackbox logs for `MQTT connect failed, rc=X`:
   - `rc=1` — incorrect protocol version
   - `rc=3` — server unavailable
   - `rc=4` — bad username or password
   - `rc=5` — not authorized

**Sensors show "unavailable" in HA:**
The `availability_topic` is `trackbox/status`. If Trackbox is stopped, the LWT sets this to `offline` and all sensors show unavailable. This is expected behavior. Start Trackbox to restore availability.

**Attribute values are stale:**
Attributes are refreshed on every state change and every 15-minute heartbeat. If values appear stale beyond 15 minutes, check that the Trackbox process is running and that the broker is connected.

**"MQTT: sensor X attributes are N bytes (>16KB)" in logs:**
Home Assistant may truncate the attributes payload. Archive old delivered shipments to reduce payload size. Access `GET /api/shipments?state=delivered` to find candidates for archiving.
