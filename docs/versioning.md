# Versioning Strategy

## Image Tags
- `:latest` — most recent successful build
- `:<commit-sha>` — specific commit build

## Git Tags
- `deploy-YYYYMMDD-<sha>` — marks each successful production deploy

## Version Endpoint
GET /health returns:
```json
{"status": "ok", "version": "<sha>", "build_time": "<ISO8601>", "uptime_seconds": 123}
```
