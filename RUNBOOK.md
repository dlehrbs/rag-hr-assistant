# RUNBOOK — Operations Guide

Quick operational reference for running RAG HR Assistant.

## Health checks
```bash
docker compose ps                                  # all services healthy?
curl -f http://localhost:8123/api/health           # backend (inside network)
curl -f http://localhost:8000/health               # vLLM
```

## Common issues

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| Chat replies "AI engine warming up" | vLLM still loading the model | Wait ~1–3 min; check `docker compose logs vllm` |
| 502 Bad Gateway | backend/frontend container restarted, stale IP | nginx auto-resolves via docker DNS; if persistent, `docker compose restart proxy` |
| Answers say "not found" for known docs | index not built or stale | Admin → Documents → **Re-index** |
| Out-of-memory on GPU | model + RAG on same GPU | Lower `--gpu-memory-utilization`, or place RAG on a second GPU |
| Web fallback never triggers | `SEARXNG_URL` unset/unreachable | Optional feature — set it only if you run a SearXNG instance |

## Backup
```bash
bash backup.sh          # snapshots the SQLite DB + index (see script)
```
Databases live in `data/databases/` (git-ignored). Back them up on your schedule.

## Updating documents
1. Add/replace files in `data/documents/`.
2. Admin console → **Documents → Re-index** (zero-downtime; the new index swaps in atomically).

## Rebuild & redeploy
```bash
# bump APP_VERSION in .env, then:
docker compose up -d --build
```

## Logs
```bash
docker compose logs -f backend      # Korean request logs, heartbeat (GPU temp / today's queries)
docker compose logs -f vllm
```
