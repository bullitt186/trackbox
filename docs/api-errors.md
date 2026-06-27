# API Error Responses

All errors return JSON:
```json
{"detail": "Error description"}
```

## Status Codes
- 200: Success
- 404: Shipment/parser not found
- 422: Invalid request body
- 429: Rate limit exceeded (30 req/min on /ingest)
- 500: Internal error (check logs)
