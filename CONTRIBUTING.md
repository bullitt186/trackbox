# Contributing to Trackbox

## Setup
```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
pre-commit install
```

## Development
```sh
make dev      # Start dev server with hot reload
make test     # Run tests
make lint     # Run linter
make build    # Build Docker image locally
```

## CI/CD
Push to `main` triggers: lint → test → security scan → build → deploy → verify → notify.
See docs/ci-pipeline.md for details.
