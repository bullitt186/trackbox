# Trackbox — Feature Reference

## Core System

- Email-driven parcel tracking via HTTP POST `/ingest`
- AI-bootstrapped deterministic parsers (OpenAI gpt-4o)
- Parser reuse: once learned, subsequent emails skip AI entirely
- Self-healing: if parser extracts all-None, falls back to AI and regenerates
- SQLite persistence with WAL mode
- Shipment state machine: unknown → preparing → shipped → in_transit → out_for_delivery → delivered (+ lateral: delayed, exception)
- Forward-only state progression (delayed/exception always allowed)
- Message-id deduplication (same email never processed twice)

## Email Ingestion Pipeline

- Fingerprinting: sender domain + normalized subject keywords
- Strips quoted content, bracketed text, DHL merchant names, Hermes merchant names, apology prefixes, trailing "Jetzt Live verfolgen"
- Stopword removal for stable fingerprints across merchants
- field_map strategies: `after_label`, `link_containing`, `literal`, `none`
- HTML body support: sends both plain text and raw HTML
- `strip_html()` preserves `<a href>` URLs and line breaks
- `link_containing` strategy searches both plain text and raw HTML
- Tracking number extraction from carrier URL parameters (DHL piececode, Hermes fragment, GLS match, UPS tracknum, FedEx trknbr, Amazon orderId)
- Tracking number cleanup (strips trailing non-alphanumeric garbage)
- Carrier auto-detection from sender domain (DHL, Hermes, DPD, GLS, UPS, FedEx, Amazon)
- Merchant name extraction from DHL "Ihre X Sendung" and Hermes "Sendung von X" subjects
- Tracking link normalization to persistent public URLs (DHL, Hermes, DPD, GLS, UPS, FedEx, fallback to parcelsapp.com)
- Title improvement: later emails with longer/better titles overwrite generic ones
- Tracking link always updated when a normalized public URL is available
- Optional `product_name` parameter overrides title
- Optional `date` parameter uses email sent timestamp for events and first_seen_at
- Optional `message_id` parameter enables deduplication
- Enriched ingest response includes title, tracking_number, tracking_link, carrier

## API Endpoints

Interactive API docs are available at `GET /docs` (Swagger UI) and `GET /redoc` when the app is running. For full request/response documentation see [docs/api.md](docs/api.md) and [docs/api-ingest.md](docs/api-ingest.md).

| Method | Path | Description |
|--------|------|-------------|
| POST | `/ingest` | Process incoming email — see [docs/api-ingest.md](docs/api-ingest.md) |
| GET | `/health` | Health check (DB connectivity, version, uptime) |
| GET | `/api/shipments` | List all shipments (`?state=active\|delivered\|archived`), sorted by urgency, includes `last_event`, `stalled`, `stall_reason` |
| GET | `/api/shipments/{id}` | Single shipment with full event history and `tracking_expires_at` |
| PUT | `/api/shipments/{id}` | Update shipment fields (title, state, carrier, etc); state transitions respect state machine |
| DELETE | `/api/shipments/{id}` | Delete shipment and events |
| GET | `/api/stats` | System statistics (by state, parser count, events) |
| GET | `/api/parsers` | List all parsers with use counts |
| DELETE | `/api/parsers/{id}` | Delete a parser (forces AI re-extraction on next matching email) |
| GET | `/api/settings` | Get all settings as key-value pairs |
| PUT | `/api/settings` | Update settings (enforces min interval, max retention) |
| GET | `/api/scrape-log` | Query scrape attempt history (`?shipment_id`, `?carrier`, `?status`, `?limit`) |
| GET | `/api/scrapers` | List scrapers with status, enabled state, and scheduler info |
| GET | `/api/imap/status` | IMAP poller health (enabled, last poll, last error, emails processed) |
| POST | `/api/shipments/{id}/scrape` | Trigger immediate scrape (6-second cooldown) |
| PUT | `/api/shipments/{id}/scrape` | Enable/disable scraping; re-enabling resets `scrape_fail_count` to 0 |

## Web UI (Jinja2 Server-Rendered)

### Index Page (`/`)
- Active shipments section with state, carrier, track link, relative timestamp
- Delivered shipments in collapsible `<details>` section
- Summary line ("X active, Y delivered")
- "All delivered" celebration message when no active
- Tracking number shown in monospace below title
- Title truncation with ellipsis
- Delayed/exception rows highlighted in red
- Carrier emoji indicators (DHL 🟡, Hermes 🔵, DPD 🔴, Amazon 📦)
- Track link button per shipment
- State badge tooltips explaining meaning
- 60-second auto-refresh
- Navigation footer (Statistics, Parsers)

### Detail Page (`/shipments/{id}`)
- Visual progress bar (step indicator: Preparing → Shipped → In Transit → Out for Delivery → Delivered)
- Pulsing animation on current progress dot
- "Next expected state" hint
- Metadata grid (carrier, tracking number, order number, tracking link, first seen, last updated)
- Click-to-copy tracking number
- "Track Package" CTA button
- Inline title edit form
- State update form with human-readable dropdown + notes
- Flash confirmation after state update
- Collapsible event history with count
- Event source icons (📧 email, ✏️ manual)
- Relative timestamps
- Subtle delete button (de-emphasized)
- Keyboard shortcut: 't' opens tracking link

### Statistics Page (`/stats`)
- Stat cards: total shipments, active, delivered, parsers, events, AI calls saved %
- Bar chart: shipments by state (color-coded)
- Bar chart: top carriers (with emojis)
- Recent activity timeline (last 10 events)
- Relative timestamps

### Parsers Page (`/parsers`)
- Parser cards with sender domain and keywords
- Use count with heat coloring (hot/warm/cold)
- Expandable field map details
- Card hover lift effect
- Empty state message

### Theming & Visual
- Dark mode via `prefers-color-scheme` (automatic)
- Manual theme toggle button (fixed position, persisted in localStorage)
- Keyboard shortcut: 'd' toggles dark mode
- CSS variables for full theming
- `[data-theme]` override support
- Gradient title on index
- Smooth transitions on hover/focus
- `::selection` highlight color
- Focus-visible accessibility outlines
- Smooth scroll
- Fade-in page animation
- Mobile responsive (table → cards on small screens)
- Package emoji favicon (📦)
- Footer with branding

## n8n Integration

- Mail Manager workflow (`xeyS4Ze0HsphO6BF`) at n8n.stahmer.net
- AI classifier with "tracking" category for shipping emails
- Sends `{from, subject, body, html, message_id, date}` to `http://trackbox:8000/ingest`
- IF node skips move/mark-read on dedup ("skipped" action)
- Marks email as read in INBOX
- Moves email to "Notifications" IMAP folder
- Email UID referenced via `$('Classify Email').item.json.attributes.uid`

## Deployment

- Docker container (`git.stahmer.net/bullitt/trackbox:latest`)
- Part of n8n stack on docker host (192.168.0.50)
- Accessible internally at `http://trackbox:8000` (n8n-infra network)
- Accessible at `http://192.168.0.50:8900` (host port)
- Traefik routing at `http://trackbox.stahmer.lan`
- Docker healthcheck via `/health` endpoint
- SQLite data persisted at `/srv/docker-data/volumes/n8n/trackbox/`
- Komodo GitOps auto-deploy from `bullitt/docker` repo
- Source on Forgejo at `git.stahmer.net/bullitt/trackbox`
- Forgejo Actions CI workflow defined (runner needs Docker CLI fix for automation)
- CORS enabled for frontend development
- Static file serving for frontend builds at `/app`

## Frontend Architecture (shadcn-ready)

- Vite 6 + React 19 + TypeScript 5 + Tailwind CSS 3
- Path aliases: `@/components`, `@/lib`, `@/hooks`, `@/types`
- `components.json` for shadcn CLI compatibility
- CSS HSL variables (light + dark themes, shadcn base layer)
- Tailwind config with shadcn color tokens and border-radius tokens
- `cn()` utility (clsx-based, ready for tailwind-merge)
- `relativeTime()` and `STATE_LABELS` utilities
- TypeScript interfaces: `Shipment`, `ShipmentEvent`, `ShipmentState`, `Parser`, `Stats`
- API client module (`lib/api.ts`) with full CRUD
- `useShipments()` hook with auto-refresh
- `ShipmentCard` component
- Directory structure: `components/ui/`, `lib/`, `hooks/`, `types/`
- Vite API proxy for development
- Production build verified (TypeScript strict, Vite build passes)
- Dark mode via Tailwind `class` strategy

## Database Schema

```sql
shipments: id, title, tracking_number, order_number, carrier, tracking_link, current_state, first_seen_at, last_updated_at
events: id, shipment_id, state, notes, source, occurred_at, message_id
parsers: id, sender_domain, subject_keywords (JSON), field_map (JSON), created_at, use_count
```
