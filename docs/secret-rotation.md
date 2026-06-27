# Secret Rotation

## OpenAI API Key
1. Generate new key at https://platform.openai.com/api-keys
2. Update in n8n stack .env: `TRACKBOX_OPENAI_API_KEY=new-key`
3. Restart: `docker restart trackbox`
4. Verify: `curl -s http://192.168.0.50:8900/health`

## Forgejo Registry Token (REGISTRY_TOKEN)
1. Generate at http://git.stahmer.lan/user/settings/applications
2. Update Forgejo repo secret via API or UI
3. Next CI run will use new token

## Komodo API Key/Secret
1. Regenerate in Komodo UI
2. Update repo secrets: KOMODO_KEY, KOMODO_SECRET
3. Update scripts/rollback.sh defaults
