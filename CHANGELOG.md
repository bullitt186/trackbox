# Changelog

All notable changes to Trackbox are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

## [0.1.0] — 2026-06-27

### Added
- Initial production release: email ingestion, AI-powered field extraction, parcel tracking, MQTT/Home Assistant integration.
- IMAP polling for automated email pickup.
- DHL carrier scraper (HTML + optional API).
- React 19 + TypeScript + Tailwind CSS frontend (served alongside the FastAPI backend).
- Semver versioning: `VERSION` file at repo root; CI tags images as `v<VERSION>` in addition to the git SHA.
- `CHANGELOG.md` tracking all user-visible changes going forward.

### Changed
- Versioned migration runner replaces silent `try/except` `ALTER TABLE` blocks in `db.py`; every migration is recorded in `_migrations` with a timestamp and failures propagate rather than being swallowed.
- `requirements.lock` now contains production dependencies only; dev tools (`pytest`, `ruff`, `mypy`, `pip-audit`) moved to `requirements-dev.txt`.
- `make lock` uses an isolated venv so dev tools can never contaminate the production lock file.
- CORS policy tightened: `allow_origins` reads from the `CORS_ORIGINS` env var (default: `http://localhost:5173,http://192.168.0.50:8900`) instead of the previous `*`.
- Dockerfile base images (`python:3.12-slim`, `node:20-slim`) pinned to SHA-256 digests for reproducible builds.
- `HEALTHCHECK` directive added to the production Docker image stage so Docker and Komodo have a native health signal.
- Startup validation (`config.validate_config()`) now checks that `DATABASE_PATH`'s parent directory exists and is writable, and logs loud warnings for missing IMAP credentials; the app refuses to start if critical config is absent rather than silently creating a new empty database.
- Pre-deploy backup wired into CI — `scripts/backup.sh` is called via SSH before `docker stop` so every deploy has a recovery point.
- Blue-green deploy in CI: the new container is launched under a temporary name, health-checked, and only then does the old container get removed.
- Hard-coded Komodo credentials removed from `scripts/rollback.sh`; the script now fails fast if `KOMODO_KEY` or `KOMODO_SECRET` are not set in the environment.

[Unreleased]: https://git.stahmer.net/bullitt/trackbox/compare/v0.1.0...HEAD
[0.1.0]: https://git.stahmer.net/bullitt/trackbox/releases/tag/v0.1.0
