# n8n Integration Setup Guide

This guide explains how to set up an n8n workflow that feeds shipping emails into Trackbox. The reference implementation is workflow `xeyS4Ze0HsphO6BF` (Mail Manager) running at n8n.stahmer.net.

## Overview

The workflow pattern:
1. An Email Trigger (IMAP) node receives new emails
2. An AI Classifier node decides if the email is a shipping notification
3. An HTTP Request node POSTs the email to `POST /ingest`
4. An IF node checks the `action` field in the response
5. Mark-read and move nodes process the email in the IMAP mailbox

## Prerequisites

- n8n instance with the Email Trigger (IMAP) node available
- Trackbox accessible from the n8n network (e.g. `http://trackbox:8000` on the same Docker network, or a public URL)
- OpenAI credentials in n8n (for the AI Classifier)

## Node configuration

### 1. Email Trigger (IMAP)

Configure the IMAP connection to your email account. Key settings:

| Setting | Recommended value |
|---------|------------------|
| Mailbox | `INBOX` |
| Action | Download attachments: No |
| Format | Simple |

The trigger fires for each new (UNSEEN) email. The following fields are available in subsequent nodes:

- `from` — sender address
- `subject` — subject line
- `text` — plain text body
- `html` — HTML body
- `headers.message-id` — RFC 5322 Message-ID
- `date` — email sent date

### 2. AI Classifier (optional but recommended)

Use an AI node to classify emails before sending to Trackbox. This prevents non-tracking emails (newsletters, receipts without tracking data) from hitting the `/ingest` endpoint and being processed (they would be `rejected` anyway, but the AI call cost is avoided).

Prompt example:
```
Classify this email into one of these categories:
- tracking: shipping notification, parcel tracking update, order shipped
- other: everything else

Email subject: {{ $json.subject }}
Email from: {{ $json.from.value[0].address }}
```

Set the output variable to `category`. Use `{{ $json.category == 'tracking' }}` in the IF node or route only `tracking` emails to the HTTP Request node.

### 3. HTTP Request node

This is the core integration step.

| Setting | Value |
|---------|-------|
| Method | POST |
| URL | `http://trackbox:8000/ingest` (adjust to your Trackbox address) |
| Authentication | None (or add a Bearer token if you add auth middleware) |
| Body Content Type | JSON |
| Specify Body | Using JSON |

**Body (JSON):**

```json
{
  "from": "={{ $('Email Trigger').item.json.from.value[0].address }}",
  "subject": "={{ $('Email Trigger').item.json.subject }}",
  "body": "={{ $('Email Trigger').item.json.text }}",
  "html": "={{ $('Email Trigger').item.json.html }}",
  "message_id": "={{ $('Email Trigger').item.json.headers['message-id'] }}",
  "date": "={{ $('Email Trigger').item.json.date }}"
}
```

If your email trigger node is named differently, replace `$('Email Trigger')` with the correct node name.

**Optional:** If your n8n workflow has a product name or order lookup step, add:

```json
"product_name": "={{ $('Order Lookup').item.json.productName }}"
```

### 4. IF node — dedup check

After the HTTP Request node, add an IF node to route `skipped` responses away from the mark-read/move flow.

| Condition | Value |
|-----------|-------|
| Field | `{{ $json.action }}` |
| Operation | is not equal to |
| Value | `skipped` |

**True branch** (action != "skipped"): mark email as read and move to processed folder.  
**False branch** (action == "skipped"): no action — the email was a duplicate.

Without this check, duplicate emails would be moved twice, causing IMAP errors.

### 5. Mark as read (IMAP node)

Use the IMAP node in "Mark as Read" mode.

| Setting | Value |
|---------|-------|
| Operation | Mark as Read |
| UID | `={{ $('Email Trigger').item.json.attributes.uid }}` |
| Mailbox | `INBOX` |

### 6. Move email (IMAP node)

| Setting | Value |
|---------|-------|
| Operation | Move |
| UID | `={{ $('Email Trigger').item.json.attributes.uid }}` |
| Source mailbox | `INBOX` |
| Destination mailbox | `Notifications` (or your preferred folder) |

## Complete workflow structure

```
[Email Trigger] → [AI Classifier] → [HTTP Request /ingest]
                                         ↓
                               [IF action != "skipped"]
                                 ↓ true          ↓ false
                           [Mark as Read]     (no-op)
                                 ↓
                           [Move Email]
```

## Handling the ingest response

The HTTP Request node captures the full `/ingest` response. You can use this in downstream nodes:

| Expression | Description |
|------------|-------------|
| `{{ $json.action }}` | `created`, `updated`, `skipped`, `rejected`, `error` |
| `{{ $json.shipment_id }}` | Database ID of the created/updated shipment |
| `{{ $json.tracking_number }}` | Extracted tracking number |
| `{{ $json.carrier }}` | Detected carrier |
| `{{ $json.state }}` | Current shipment state |

Example: send a Pushover notification only when a new shipment is created:

Add a second IF node after the HTTP Request with condition `{{ $json.action == 'created' }}` and connect a notification node to the true branch.

## Troubleshooting

**All emails return `rejected`:**  
The emails may not contain trackable fields. Check the raw email body; the n8n AI Classifier should be filtering out non-shipping emails upstream.

**Emails return `skipped` on first send:**  
The `message_id` field may be duplicated (some email providers reuse Message-IDs). Try clearing the Message-ID field in the HTTP body temporarily to confirm.

**`action` is `error`:**  
Check the Trackbox logs for the `request_id` returned in the response:
```bash
docker logs trackbox 2>&1 | grep "request_id_value"
```

**n8n cannot reach `http://trackbox:8000`:**  
Ensure both n8n and Trackbox are on the same Docker network. In Docker Compose:
```yaml
networks:
  n8n-infra:
    external: true
```
Add this network to both the Trackbox and n8n service definitions.

## Alternative: IMAP poller (no n8n required)

If you prefer not to use n8n, Trackbox has a built-in IMAP poller that works without any workflow. Set the `IMAP_*` environment variables and the poller will poll your mailbox every 5 minutes (configurable). See [setup.md](setup.md#imap) for configuration details.

The built-in poller and the n8n workflow can run simultaneously — deduplication via `message_id` prevents double-processing.
