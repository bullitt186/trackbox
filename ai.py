import json

from openai import OpenAI

import config

VALID_STATES = [
    "unknown", "preparing", "shipped", "in_transit",
    "out_for_delivery", "delivered", "delayed", "exception"
]

SYSTEM_PROMPT = """You are an email parser for a parcel tracking system. Given a shipping notification email, you must:

1. Extract these fields from the email content:
   - order_number: the merchant's order identifier (if present)
   - tracking_number: the carrier tracking number (if present)
   - carrier: shipping carrier name (e.g. UPS, FedEx, USPS, DHL, DPD, GLS, Hermes, Amazon Logistics) (if identifiable)
   - tracking_link: full URL for tracking the package (if present)
   - title: brief description of what was ordered. If no product details are present, use just the merchant/sender name (e.g. "voelkner", "Amazon", "Banggood"). Never use the full email subject as title.
   - status: the shipment state. Must be one of: unknown, preparing, shipped, in_transit, out_for_delivery, delivered, delayed, exception

2. Generate a field_map that describes HOW each field can be extracted from similar future emails from the same sender with the same email type. The field_map uses these strategies only:
   - {"strategy": "after_label", "label": "<text>"} — the field value appears on the same line after this label text
   - {"strategy": "link_containing", "contains": "<url_substring>"} — first URL in the body containing this substring
   - {"strategy": "literal", "value": "<fixed_value>"} — this email type always implies this value
   - {"strategy": "none"} — this field is not extractable from this email type

Respond with JSON only:
{
  "extracted": {
    "order_number": "..." or null,
    "tracking_number": "..." or null,
    "carrier": "..." or null,
    "tracking_link": "..." or null,
    "title": "..." or null,
    "status": "..."
  },
  "field_map": {
    "order_number": {"strategy": "...", ...},
    "tracking_number": {"strategy": "...", ...},
    "carrier": {"strategy": "...", ...},
    "tracking_link": {"strategy": "...", ...},
    "title": {"strategy": "...", ...},
    "status": {"strategy": "...", ...}
  }
}"""


def extract_and_generate_parser(email: dict) -> tuple[dict | None, dict | None]:
    """
    Call OpenAI to extract shipment fields AND generate a field_map.
    Returns (extracted_fields, field_map) or (None, None) on failure.
    """
    client = OpenAI(api_key=config.OPENAI_API_KEY)
    model = config.OPENAI_MODEL

    body = email['body']
    html = email.get('html', '')
    # If body is very short but HTML is available, include first 2000 chars of HTML for context
    html_hint = ""
    if html and len(body) < 100:
        html_hint = f"\n\nHTML (raw, first 2000 chars):\n{html[:2000]}"
    user_content = f"From: {email['from']}\nSubject: {email['subject']}\n\nBody:\n{body}{html_hint}"

    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ],
            response_format={"type": "json_object"},
            temperature=0,
        )
        data = json.loads(response.choices[0].message.content)
    except Exception:
        return None, None

    extracted = data.get("extracted", {})
    field_map = data.get("field_map", {})

    # Validate status
    if extracted.get("status") not in VALID_STATES:
        extracted["status"] = "unknown"

    # Validate field_map strategies
    valid_strategies = {"after_label", "link_containing", "literal", "none"}
    for key in list(field_map.keys()):
        if not isinstance(field_map[key], dict) or field_map[key].get("strategy") not in valid_strategies:
            field_map[key] = {"strategy": "none"}

    return extracted, field_map
