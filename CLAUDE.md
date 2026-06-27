# Trackbox — Project Instructions

## Architecture

- **Backend**: Python 3.12, FastAPI, SQLite (WAL mode), OpenAI API
- **Frontend** (WIP): Vite + React 19 + TypeScript + Tailwind CSS (shadcn-ready)
- **CI/CD**: Forgejo Actions → Docker build → Push to registry → Komodo deploy
- **Deployment**: Docker container in n8n stack on `docker` host (192.168.0.50)

## Key Files

- `main.py` — FastAPI app, routes, middleware
- `ingest.py` — Email processing pipeline (fingerprint → parse → match → store)
- `db.py` — SQLite schema and queries
- `ai.py` — OpenAI integration for field extraction + parser generation
- `config.py` — Centralized configuration (all env vars here)
- `templates/` — Jinja2 server-rendered UI (will be replaced by React frontend)

## Development

```sh
source .venv/bin/activate
make dev    # uvicorn with reload
make test   # pytest
make lint   # ruff
make build  # docker build
```

## Conventions

- All config reads go through `config.py`, never direct `os.getenv()`
- Use `with get_db() as conn:` for new DB code (context manager auto-closes)
- Ruff enforces import sorting (I001) and unused vars (F401)
- Tests in `tests/test_*.py`, run via pytest
- Every commit to main triggers full CI pipeline
- No manual deploys — push to main is the only deploy mechanism

## CI Pipeline

Push to main → Lint (ruff) → Test (pytest + coverage) → Security (pip-audit) → Build → Push → Deploy → Health check → Smoke test → Tag → Notify

## Do NOT

- Change Komodo platform configuration
- Change n8n workflow structure
- Modify the forgejo-runner setup
- Add dependencies without updating `requirements.lock`
- Skip the test stage in Docker builds
