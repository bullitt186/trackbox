# Disaster Recovery Runbook

## Scenario: Container won't start
1. Check logs: `docker logs trackbox`
2. Verify volume: `ls -la /srv/docker-data/volumes/n8n/trackbox/`
3. Check DB integrity: `sqlite3 /srv/docker-data/volumes/n8n/trackbox/trackbox.db "PRAGMA integrity_check"`
4. Redeploy: Komodo → n8n stack → Deploy

## Scenario: Database corrupted
1. Stop container: `docker stop trackbox`
2. Restore from backup: `cp /srv/docker-data/volumes/n8n/trackbox/backups/trackbox_LATEST.db /srv/docker-data/volumes/n8n/trackbox/trackbox.db`
3. Restart: `docker start trackbox`
4. Verify: `curl http://192.168.0.50:8900/health`

## Scenario: Rollback to previous version
1. Find last good tag: `git tag -l 'deploy-*' | tail -5`
2. Run: `./scripts/rollback.sh deploy-YYYYMMDD-SHA`

## Scenario: OpenAI API key expired
1. Update `.env` on host: `sudo vim /etc/komodo/repos/docker/n8n/.env`
2. Restart trackbox: `docker restart trackbox`

## Scenario: CI broken
1. Check runner: `docker ps --filter name=forgejo-runner`
2. Check logs: `docker logs forgejo-runner --tail 20`
3. Manual build: `cd /tmp && git clone http://192.168.0.2:3002/bullitt/trackbox.git && cd trackbox && docker build -t git.stahmer.lan/bullitt/trackbox:latest .`
