"""Outgoing webhook notifier — posts state-change events to a configurable HTTP endpoint."""

from __future__ import annotations

import json
import logging

import httpx

import settings as app_settings

log = logging.getLogger("trackbox.webhook")


class WebhookNotifier:
    """Sends a JSON POST to a user-configured webhook URL on state changes."""

    def _url(self) -> str:
        return app_settings.get_setting("webhook_url", "")

    def _is_enabled(self) -> bool:
        url = self._url()
        if not url:
            return False
        return app_settings.get_setting("webhook_enabled", "false").lower() == "true"

    async def start(self) -> None:
        if self._is_enabled():
            log.info("Webhook notifier enabled — url=%s", self._url())
        else:
            log.info("Webhook notifier disabled (webhook_enabled=false or webhook_url not set)")

    async def stop(self) -> None:
        pass

    async def publish(self, event_type: str, payload: dict) -> None:
        if not self._is_enabled():
            return
        url = self._url()
        body = {"event": event_type, **payload}
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    url,
                    content=json.dumps(body),
                    headers={"Content-Type": "application/json"},
                )
            if resp.status_code >= 400:
                log.warning("Webhook POST to %s returned %d", url, resp.status_code)
            else:
                log.debug("Webhook POST to %s returned %d", url, resp.status_code)
        except Exception as e:
            log.warning("Webhook POST to %s failed: %s", url, e)
