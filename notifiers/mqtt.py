"""MQTT notifier — publishes Trackbox state as Home Assistant MQTT autodiscovery sensors."""

from __future__ import annotations

import asyncio
import json
import logging
import sys
from typing import Any

import config
import db
import settings as app_settings

log = logging.getLogger("trackbox.mqtt")

_HEARTBEAT_INTERVAL = 900  # 15 minutes

_SENSOR_DEFS = [
    # (unique_id_suffix, friendly_name, icon, value_key_in_payload)
    # Count sensors — value comes from the published payload dict
    ("total",            "Trackbox Total Shipments",       "mdi:package-variant",          "total"),
    ("active",           "Trackbox Active Shipments",      "mdi:truck-delivery",            "active"),
    ("delivered",        "Trackbox Delivered Shipments",   "mdi:package-check",             "delivered"),
    ("archived",         "Trackbox Archived Shipments",    "mdi:archive",                   "archived"),
    ("stalled",          "Trackbox Stalled Shipments",     "mdi:truck-alert",               "stalled"),
    ("preparing",        "Trackbox Preparing",             "mdi:package-variant-closed",    "preparing"),
    ("shipped",          "Trackbox Shipped",               "mdi:shipping-pallet",           "shipped"),
    ("in_transit",       "Trackbox In Transit",            "mdi:truck",                     "in_transit"),
    ("out_for_delivery", "Trackbox Out for Delivery",      "mdi:truck-fast",                "out_for_delivery"),
    ("delayed",          "Trackbox Delayed",               "mdi:truck-remove",              "delayed"),
    ("exception",        "Trackbox Exception",             "mdi:truck-alert-outline",       "exception"),
    # String sensors
    ("version",          "Trackbox Version",               "mdi:information",               "version"),
    ("url",              "Trackbox URL",                   "mdi:web",                       "url"),
]

_ATTR_SENSORS = {
    "total", "active", "delivered", "archived", "stalled",
    "preparing", "shipped", "in_transit", "out_for_delivery", "delayed", "exception",
}

_ATTRIBUTE_SIZE_WARN = 16 * 1024  # 16 KB


def _build_payload() -> dict:
    """Query the DB and assemble the full sensor payload."""
    conn = db.get_conn()
    rows = conn.execute("SELECT * FROM shipments").fetchall()
    conn.close()

    shipments = [dict(r) for r in rows]

    # Counters
    active_list = [s for s in shipments if not s.get("archived") and s["current_state"] != "delivered"]
    delivered_list = [s for s in shipments if not s.get("archived") and s["current_state"] == "delivered"]
    archived_list = [s for s in shipments if s.get("archived")]
    stalled_list = [
        s for s in active_list
        if s.get("scrape_fail_count", 0) >= 3
        or (s.get("scrape_enabled") == 0 and s["current_state"] != "delivered")
    ]

    by_status: dict[str, list] = {
        "preparing": [], "shipped": [], "in_transit": [],
        "out_for_delivery": [], "delayed": [], "exception": [],
    }
    for s in active_list:
        state = s["current_state"]
        if state in by_status:
            by_status[state].append(s)

    def lean(s: dict) -> dict:
        return {
            "id": s["id"],
            "name": s.get("title") or f"Shipment #{s['id']}",
            "carrier": s.get("carrier"),
            "status": s["current_state"],
            "tracking_number": s.get("tracking_number"),
            "tracking_url": s.get("tracking_link"),
            "started": s.get("first_seen_at"),
            "last_updated": s.get("last_updated_at"),
        }

    trackbox_url = app_settings.get_setting("trackbox_url", "")

    payload: dict = {
        "total": len(active_list) + len(delivered_list),
        "active": len(active_list),
        "delivered": len(delivered_list),
        "archived": len(archived_list),
        "stalled": len(stalled_list),
        "version": config.TRACKBOX_VERSION,
        "url": trackbox_url,
        # Items lists
        "active_items": [lean(s) for s in active_list],
        "delivered_items": [lean(s) for s in delivered_list],
        "archived_items": [lean(s) for s in archived_list],
        "stalled_items": [lean(s) for s in stalled_list],
    }
    for state, items in by_status.items():
        payload[state] = len(items)
        payload[f"{state}_items"] = [lean(s) for s in items]

    return payload


def _check_attr_size(sensor_id: str, attrs: dict) -> None:
    size = len(json.dumps(attrs).encode())
    if size > _ATTRIBUTE_SIZE_WARN:
        log.warning("MQTT: sensor %s attributes are %d bytes (>16KB), HA may truncate", sensor_id, size)


class MQTTNotifier:
    """Publishes Trackbox state to an MQTT broker as HA autodiscovery sensors."""

    def __init__(self) -> None:
        self._client: Any = None
        self._task: asyncio.Task | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._connected = False

    def _is_enabled(self) -> bool:
        if not config.MQTT_HOST:
            return False
        return app_settings.get_setting("mqtt_enabled", "false").lower() == "true"

    def _prefix(self) -> str:
        return app_settings.get_setting("mqtt_topic_prefix", config.MQTT_TOPIC_PREFIX)

    def _make_client(self):
        import paho.mqtt.client as mqtt

        prefix = self._prefix()

        client = mqtt.Client(client_id="trackbox", clean_session=True)
        if config.MQTT_USER:
            client.username_pw_set(config.MQTT_USER, config.MQTT_PASSWORD or None)

        client.will_set(f"{prefix}/status", payload="offline", retain=True)

        def on_connect(c, userdata, flags, rc):
            if rc == 0:
                self._connected = True
                log.info("MQTT connected to %s:%s", config.MQTT_HOST, config.MQTT_PORT)
                c.publish(f"{prefix}/status", "online", retain=True)
                self._publish_discovery(c, prefix)
                self._publish_state(c, prefix)
            else:
                log.warning("MQTT connect failed, rc=%d", rc)

        def on_disconnect(c, userdata, rc):
            self._connected = False
            if rc != 0:
                log.warning("MQTT unexpectedly disconnected, rc=%d", rc)

        client.on_connect = on_connect
        client.on_disconnect = on_disconnect
        return client

    def _publish_discovery(self, client, prefix: str) -> None:
        device = {
            "identifiers": ["trackbox"],
            "name": "Trackbox",
            "model": "Trackbox",
            "sw_version": config.TRACKBOX_VERSION,
            "manufacturer": "Trackbox",
        }
        for uid, name, icon, _ in _SENSOR_DEFS:
            state_topic = f"{prefix}/sensor/{uid}"
            cfg = {
                "unique_id": f"trackbox_{uid}",
                "name": name,
                "state_topic": state_topic,
                "availability_topic": f"{prefix}/status",
                "icon": icon,
                "device": device,
            }
            if uid in _ATTR_SENSORS:
                cfg["json_attributes_topic"] = f"{prefix}/sensor/{uid}/attributes"
            disco_topic = f"homeassistant/sensor/trackbox_{uid}/config"
            client.publish(disco_topic, json.dumps(cfg), retain=True)

    def _publish_state(self, client, prefix: str) -> None:
        payload = _build_payload()
        for uid, _, _, value_key in _SENSOR_DEFS:
            state_topic = f"{prefix}/sensor/{uid}"
            client.publish(state_topic, str(payload.get(value_key, "")), retain=True)
            if uid in _ATTR_SENSORS:
                attrs = {"items": payload.get(f"{uid}_items", [])}
                _check_attr_size(uid, attrs)
                client.publish(f"{prefix}/sensor/{uid}/attributes", json.dumps(attrs), retain=True)

    async def start(self) -> None:
        if not self._is_enabled():
            log.info("MQTT notifier disabled (mqtt_enabled=false or MQTT_HOST not set)")
            return

        if "paho" not in sys.modules:
            try:
                import paho.mqtt.client  # noqa: F401
            except ImportError:
                log.error("paho-mqtt not installed; MQTT notifier unavailable")
                return

        self._loop = asyncio.get_event_loop()
        self._client = self._make_client()

        try:
            self._client.connect(config.MQTT_HOST, config.MQTT_PORT, keepalive=60)
        except Exception as e:
            log.error("MQTT connect error: %s", e)
            return

        self._client.loop_start()
        self._task = asyncio.create_task(self._heartbeat())
        log.info("MQTT notifier started")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
        if self._client:
            prefix = self._prefix()
            try:
                self._client.publish(f"{prefix}/status", "offline", retain=True)
            except Exception:
                pass
            self._client.loop_stop()
            self._client.disconnect()
        log.info("MQTT notifier stopped")

    async def _heartbeat(self) -> None:
        while True:
            await asyncio.sleep(_HEARTBEAT_INTERVAL)
            await self.publish("heartbeat", {})

    async def publish(self, event_type: str, payload: dict) -> None:  # noqa: ARG002
        if not self._client or not self._connected:
            return
        prefix = self._prefix()
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self._publish_state, self._client, prefix)
