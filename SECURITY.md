# Security Policy

## Reporting Vulnerabilities

Report security issues to bastian@stahmer.net.

## Supported Versions

Only the latest version on main is supported.

## Security Measures

- Dependencies scanned by pip-audit on every CI run
- Rate limiting on /ingest endpoint (30 req/min)
- CORS configured (currently permissive for dev)
- No user authentication (deploy behind reverse proxy)
- SQLite file permissions: container-local
- OpenAI API key stored as environment variable (not in code)
