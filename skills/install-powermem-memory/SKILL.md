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

1. **Check OpenClaw**  
   Run `openclaw --version`. If not installed, tell the user to install OpenClaw first: `npm install -g openclaw` and `openclaw onboard`.

2. **Check PowerMem**  
   - **HTTP mode**: User must have PowerMem server running (e.g. `pip install powermem`, create `.env`, then `powermem-server --port 8000`).  
   - **CLI mode**: User needs `pmem` on PATH (and optionally a PowerMem `.env`). No server required.

3. **Install the plugin**  
   If the user has the repo path:
   ```bash
   openclaw plugins install /path/to/openclaw-extension-powermem
   ```
   Or from GitHub one-liner:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/ob-labs/openclaw-extension-powermem/main/install.sh | bash
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
| `openclaw ltm health` fails | For HTTP: ensure PowerMem server is running and `baseUrl` is correct. For CLI: ensure `pmem` is on PATH and optional `.env` is valid. |
| Plugin not loaded | Check `plugins.slots.memory` is `memory-powermem` and restart gateway. |
| Add/search returns 500 or empty | Check PowerMem server logs; usually LLM/Embedding API key or model in PowerMem `.env`. |
