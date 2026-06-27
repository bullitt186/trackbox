# CI/CD Pipeline

## Trigger
Push to `main` branch.

## Stages
1. **Checkout** — clone from Forgejo (192.168.0.2:3002)
2. **Test** — Docker build `--target test` (ruff + pytest + coverage + pip-audit)
3. **Build** — Docker build `--target production` with VERSION arg
4. **Push** — Push to git.stahmer.net registry (SHA tag + :latest)
5. **Deploy** — Stop container, trigger Komodo DeployStack
6. **Verify** — Health check + smoke test (POST /ingest)
7. **Tag** — Create git tag `deploy-YYYYMMDD-SHA`
8. **Notify** — Apprise (email + Signal) on success/failure

## Concurrency
Forgejo automatically cancels in-progress runs when new push arrives.

## Secrets
- `REGISTRY_TOKEN` — Forgejo API token for registry push
- `KOMODO_KEY` / `KOMODO_SECRET` — Komodo API credentials

## Runner
- Host: docker (192.168.0.50)
- Type: `docker-build:host` (Alpine, Docker socket mounted)
- Image: gitea/act_runner:latest

## Rollback
```sh
./scripts/rollback.sh deploy-YYYYMMDD-SHA
```

## Build Metrics
Average build time: ~90 seconds (test ~30s, build ~40s, deploy ~20s)

