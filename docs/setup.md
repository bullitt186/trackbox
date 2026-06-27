# First-Run Setup Guide

This guide covers setting up Trackbox from scratch on a self-hosted Docker environment.

## Prerequisites

- Docker and Docker Compose (or a container runtime)
- An OpenAI API key (required for AI parsing of new email formats)
- Optionally: an IMAP mailbox, an MQTT broker, or a DHL developer API key

## Minimum viable setup (5 minutes)

The only required variable is `OPENAI_API_KEY`. Everything else is optional progressive enhancement.

```bash
# 1. Copy the example env file
cp .env.example .env

# 2. Set your OpenAI key
echo 'OPENAI_API_KEY=sk-...' >> .env

# 3. Start the container
docker compose up -d

# 4. Verify it's running
curl http://localhost:8000/health
```

The app is now live at `http://localhost:8000`. You can send emails to `/ingest` manually or via n8n. Carrier scraping, IMAP polling, and MQTT notifications are all disabled until configured.

## Full configuration reference

All environment variables are read from `.env` (or the host environment). The table below covers all 17 variables across four subsystems.

### Core

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `OPENAI_API_KEY` | — | **Yes** | OpenAI API key used by the AI extraction stage. Without this, only emails matching existing parsers will be processed correctly. New email formats will produce `status: unknown` with `parser_status: failed`. |
| `OPENAI_MODEL` | `gpt-4o` | No | OpenAI model used for AI extraction and parser generation. `gpt-4o` is recommended; `gpt-4o-mini` is significantly cheaper with slightly lower accuracy on complex email formats. |
| `DATABASE_PATH` | `trackbox.db` | No | Path to the SQLite database file. In Docker, always set this to a path inside a named volume (e.g. `/app/data/trackbox.db`) so data persists across container restarts. |
| `RATE_LIMIT_PER_MINUTE` | `30` | No | Maximum number of `/ingest` requests per minute. Adjust upward if you have a high-volume email flow. |
| `TRACKBOX_VERSION` | `dev` | No | Injected by the CI pipeline. Do not set manually. |
| `TRACKBOX_BUILD_TIME` | `unknown` | No | Injected by the CI pipeline. Do not set manually. |

### DHL API (optional — only needed if using DHL API scraper)

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `DHL_API_KEY` | — | No | DHL Shipment Tracking - Unified API key. Obtain from [developer.dhl.com](https://developer.dhl.com). The free tier allows 250 calls/day. If not set, the `dhl_web` scraper is used automatically (no API key, but more fragile). |
| `DHL_API_SECRET` | — | No | DHL API secret. Reserved for future OAuth flows; not currently used. |

### IMAP (optional — enables direct mailbox polling)

Set these variables to enable Trackbox to poll an IMAP mailbox directly, without needing n8n or a webhook.

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `IMAP_HOST` | — | No (enables IMAP) | IMAP server hostname (e.g. `mail.example.com`). If not set, IMAP polling is silently disabled. |
| `IMAP_PORT` | `993` | No | IMAP port. Use `993` for SSL (default) or `143` for STARTTLS. |
| `IMAP_USER` | — | No (enables IMAP) | IMAP username (usually the full email address). If not set alongside `IMAP_HOST`, IMAP is disabled. |
| `IMAP_PASSWORD` | — | No | IMAP password or app-specific password. |
| `IMAP_SSL` | `true` | No | Set to `false` to connect without SSL (e.g. for a local mail server on port 143). |
| `IMAP_FOLDER` | `INBOX` | No | The mailbox folder to scan for new (UNSEEN) emails. |
| `IMAP_DONE_FOLDER` | `Trackbox/Processed` | No | Destination folder for processed emails. Trackbox creates this folder if it does not exist. Emails are marked as read and moved here after processing. |
| `IMAP_INTERVAL` | `300` | No | Poll interval in seconds. Default is 5 minutes. The minimum effective interval is determined by your IMAP server's connection limits. |

### MQTT / Home Assistant (optional)

Set `MQTT_HOST` to enable MQTT. You must also enable MQTT in the Settings UI after starting the app.

| Variable | Default | Description |
|----------|---------|-------------|
| `MQTT_HOST` | — | MQTT broker hostname. If not set, MQTT is disabled (no broker connection is attempted). |
| `MQTT_PORT` | `1883` | MQTT broker port. |
| `MQTT_USER` | — | MQTT username. Leave empty for brokers without authentication. |
| `MQTT_PASSWORD` | — | MQTT password. |
| `MQTT_TOPIC_PREFIX` | `trackbox` | Prefix for all published topics. Change this if you run multiple Trackbox instances on the same broker. |

## Complete .env example

```dotenv
# --- Core ---
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o
DATABASE_PATH=/app/data/trackbox.db

# --- DHL API (optional) ---
# DHL_API_KEY=
# DHL_API_SECRET=

# --- IMAP (optional) ---
# IMAP_HOST=mail.example.com
# IMAP_PORT=993
# IMAP_USER=notifications@example.com
# IMAP_PASSWORD=secret
# IMAP_SSL=true
# IMAP_FOLDER=INBOX
# IMAP_DONE_FOLDER=Trackbox/Processed
# IMAP_INTERVAL=300

# --- MQTT / Home Assistant (optional) ---
# MQTT_HOST=homeassistant.local
# MQTT_PORT=1883
# MQTT_USER=trackbox
# MQTT_PASSWORD=secret
# MQTT_TOPIC_PREFIX=trackbox
```

## Docker Compose (recommended)

```yaml
services:
  trackbox:
    image: git.stahmer.lan/bullitt/trackbox:latest
    ports:
      - "8000:8000"
    volumes:
      - trackbox-data:/app/data
    env_file: .env
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 5s
      retries: 3

volumes:
  trackbox-data:
```

## Post-start checklist

After the container is running:

1. **Verify health:** `curl http://localhost:8000/health` should return `{"status":"ok",...}`.
2. **Check MQTT (if configured):** Open Settings in the UI and toggle "MQTT Enabled". Then check your MQTT broker for `trackbox/status = "online"`.
3. **Test ingest:** Send a test email payload to `/ingest` (see [API reference](api-ingest.md)).
4. **Check logs:** All logs are JSON. Run `docker logs trackbox -f` and look for any `WARNING` lines about missing config.
5. **Open Swagger UI:** Browse to `http://localhost:8000/docs` for interactive API documentation.

## Enabling MQTT after first start

MQTT requires two steps:
1. Set `MQTT_HOST` (and optionally `MQTT_USER`/`MQTT_PASSWORD`) in `.env` and restart the container.
2. Open the Settings page in the Trackbox UI and toggle "MQTT Enabled" to on.

Both steps are required. Setting `MQTT_HOST` without enabling MQTT in Settings will not publish anything.

## Enabling DHL API scraper

1. Register at [developer.dhl.com](https://developer.dhl.com) and create a free API key under the "Shipment Tracking - Unified" product.
2. Add `DHL_API_KEY=your-key` to `.env` and restart.
3. In the Trackbox Settings page, navigate to the DHL scraper card and switch the active method from "DHL Web" to "DHL Unified API".

The DHL API scraper polls every 2 hours (vs. 1 hour for web) because the free tier is limited to 250 calls/day.
