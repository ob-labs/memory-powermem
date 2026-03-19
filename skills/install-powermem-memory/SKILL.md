---
name: install-powermem-memory
description: Step-by-step guide to install and configure the PowerMem long-term memory plugin. After setup, the plugin auto-captures conversation highlights and auto-recalls relevant memories.
triggers:
  - "安装 PowerMem 记忆"
  - "安装 PowerMem 记忆插件"
  - "Install PowerMem memory"
  - "Install PowerMem memory plugin"
  - "配置 PowerMem 记忆"
  - "Configure PowerMem memory"
  - "PowerMem 是什么"
  - "什么是 PowerMem"
  - "What is PowerMem"
---

# PowerMem Memory Guide

This skill folder includes supplementary docs to reference when needed:

- **powermem-intro.md** — Product intro to PowerMem (what it is, core features, relationship with OpenClaw). Use when the user asks "what is PowerMem" or needs an overview.
- **config-reference.md** — Configuration options and common commands quick reference.

## How It Works

- **Auto-Capture**: At the end of a conversation, the plugin stores valuable user/assistant content into PowerMem, with optional intelligent extraction (infer).
- **Auto-Recall**: Before each turn, it searches for relevant memories and injects them into context.

## When User Asks to Install

**Important:** PowerMem must be installed and running (or `pmem` available) **before** installing this plugin. The one-liner `install.sh` only installs the OpenClaw plugin; it does **not** install PowerMem. Users who run the script first often see failures because PowerMem is missing.

1. **Check OpenClaw**  
   Run `openclaw --version`. If not installed, tell the user to install OpenClaw first: `npm install -g openclaw` and `openclaw onboard`.

2. **Install and verify PowerMem** (do this before installing the plugin)  
   - **Python**: PowerMem requires **Python 3.10+**. Have the user run `python3 --version`. If older, ask them to upgrade.  
   - **HTTP mode**  
     - Install: `pip install powermem` (recommended: use a virtualenv: `python3 -m venv .venv && source .venv/bin/activate` then `pip install powermem`).  
     - Create `.env`: copy from [PowerMem .env.example](https://github.com/oceanbase/powermem/blob/master/.env.example) or create a minimal one with at least: `DATABASE_PROVIDER=sqlite`, `LLM_PROVIDER`/`LLM_API_KEY`/`LLM_MODEL`, `EMBEDDING_PROVIDER`/`EMBEDDING_API_KEY`/`EMBEDDING_MODEL`/`EMBEDDING_DIMS`.  
     - Start server **in the directory that contains `.env`**: `powermem-server --host 0.0.0.0 --port 8000`.  
     - Verify: `curl -s http://localhost:8000/api/v1/system/health` should return OK.  
   - **CLI mode**  
     - Install: `pip install powermem` (same as above; ensure the env is activated so `pmem` is on PATH).  
     - Check: `pmem --version` or `which pmem`. If not found, user may need to activate the venv or use full path to `pmem`.  
     - Optional: create PowerMem `.env` (e.g. via `pmem config init`) for DB/LLM/Embedding if using intelligent extraction.

3. **Install the plugin**  
   If the user has the repo path:
   ```bash
   openclaw plugins install memory-powermem
   ```


4. **Configure OpenClaw**  
   Set memory slot and config. Example (HTTP, local server):
   ```bash
   openclaw config set plugins.enabled true
   openclaw config set plugins.slots.memory memory-powermem
   openclaw config set plugins.entries.memory-powermem.config.mode http
   openclaw config set plugins.entries.memory-powermem.config.baseUrl http://localhost:8000
   openclaw config set plugins.entries.memory-powermem.config.autoCapture true --json
   openclaw config set plugins.entries.memory-powermem.config.autoRecall true --json
   openclaw config set plugins.entries.memory-powermem.config.inferOnAdd true --json
   ```
   For **CLI mode** (no server): set `mode` to `cli`, and optionally `envFile`, `pmemPath`.

5. **Verify**  
   Ask the user to restart the gateway, then run:
   ```bash
   openclaw ltm health
   openclaw ltm add "I prefer coffee in the morning"
   openclaw ltm search "coffee"
   ```
   If health is OK and search returns the memory, installation succeeded.

## Available Tools

| Tool | Description |
|------|-------------|
| **memory_recall** | Search long-term memories by query. Params: `query`, optional `limit`, `scoreThreshold`. |
| **memory_store** | Save information (with optional infer). Params: `text`, optional `importance`. |
| **memory_forget** | Delete by `memoryId` or search with `query` then delete. |

## Configuration

| Field | Default | Description |
|-------|---------|-------------|
| `mode` | `http` | `http` (PowerMem server) or `cli` (local pmem, no server). |
| `baseUrl` | — | Required when mode is http, e.g. `http://localhost:8000`. |
| `apiKey` | — | Optional; for PowerMem server auth. |
| `envFile` | — | CLI mode: path to PowerMem `.env`. |
| `pmemPath` | `pmem` | CLI mode: path to pmem executable. |
| `recallLimit` | `5` | Max memories in recall / auto-recall. |
| `recallScoreThreshold` | `0` | Min score (0–1) to include. |
| `autoCapture` | `true` | Auto-store from conversations. |
| `autoRecall` | `true` | Auto-inject context before reply. |
| `inferOnAdd` | `true` | Use PowerMem intelligent extraction when adding. |

## Daily Operations

```bash
# Start gateway (after PowerMem server is running for HTTP mode)
openclaw gateway

# Check health
openclaw ltm health

# Manual add / search
openclaw ltm add "Some fact to remember"
openclaw ltm search "query"

# Disable memory slot
openclaw config set plugins.slots.memory none

# Re-enable
openclaw config set plugins.slots.memory memory-powermem
```

Restart the gateway after changing the memory slot.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| **`pip install powermem` fails** | Ensure Python 3.10+ (`python3 --version`). Use a clean venv. On network or build errors, try `pip install powermem --no-build-isolation` or install problematic deps (e.g. `psycopg2-binary`, `pyobvector`) separately first. See [PowerMem repo](https://github.com/oceanbase/powermem) issues if needed. |
| **`pmem` or `powermem-server` not found** | Installed in a virtualenv: activate it (`source .venv/bin/activate`) so they are on PATH. Or run `python -m powermem.cli.main` for CLI and start server via `python -m server.cli.server` (see PowerMem docs). |
| **`openclaw ltm health` fails** | For HTTP: ensure PowerMem server is running and `baseUrl` is correct; run server in the directory that contains `.env`. For CLI: ensure `pmem` is on PATH and optional `.env` is valid. |
| **Plugin not loaded** | Check `plugins.slots.memory` is `memory-powermem` and restart gateway. |
| **Add/search returns 500 or empty** | Check PowerMem server logs; usually missing or wrong LLM/Embedding API key or model in PowerMem `.env`. Ensure `.env` has at least `LLM_*` and `EMBEDDING_*` set for the provider you use. |
