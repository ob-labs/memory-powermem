---
name: install-powermem-memory
description: Step-by-step guide to install and configure the PowerMem long-term memory plugin (full path, options, troubleshooting). After setup, the plugin auto-captures conversation highlights and auto-recalls relevant memories. This skill is self-contained and can be published independently of any minimal-install skill.
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

This skill folder includes supplementary docs:

- **powermem-intro.md** — What PowerMem is, features, vs file-based memory.
- **config-reference.md** — Config keys, state dir, commands.

## How It Works

- **Auto-Capture**: After a conversation, the plugin sends valuable user/assistant text to PowerMem (optional infer / intelligent extraction).
- **Auto-Recall**: Before each turn, it searches memories and can inject a `<relevant-memories>` block into context.

## When User Asks to Install

**Recommended order (TO C):** (1) OpenClaw installed and **default model + provider auth** configured. (2) **Python 3.10+ verified** (`python3 --version`) *before* venv / `pip install`. (3) `pip install powermem` and `pmem` available to the gateway (PATH or `pmemPath`). (4) Install the **memory-powermem** plugin. **No `powermem.env` is required** for the default path.

The curl **`install.sh`** deploys the plugin and OpenClaw entries; with **`-y`** it may still create **`~/.openclaw/powermem/powermem.env`** as an *optional* template—it does **not** run `pip install powermem`. That file is **not** required if the user relies on **OpenClaw-injected** LLM + default SQLite.

1. **Check OpenClaw**  
   `openclaw --version`. If missing: `npm install -g openclaw`, `openclaw onboard`.  
   Ensure **`agents.defaults.model`** is set (e.g. `openai/gpt-4o-mini`) and the corresponding **provider / API key** works for normal chat—the plugin reuses that for PowerMem when **`useOpenClawModel`** is true (default).

2. **Check Python (required before venv / pip)**  
   PowerMem needs **Python 3.10 or newer**. Run **`python3 --version`** first; the minor version must be **≥ 10** (e.g. 3.10.x, 3.12.x). Optional strict check:
   ```bash
   python3 -c "import sys; assert sys.version_info >= (3, 10), 'Need Python 3.10+'; print(sys.version.split()[0], 'OK')"
   ```
   If it fails: upgrade Python or use a specific binary (e.g. `python3.12`) for all commands below instead of `python3`.

3. **Install PowerMem (CLI — default)**  
   - Venv recommended: e.g. `python3 -m venv ~/.openclaw/powermem/.venv && source ~/.openclaw/powermem/.venv/bin/activate`.  
   - `pip install powermem`.  
   - **Defaults:** Plugin injects **SQLite** at `<OpenClaw stateDir>/powermem/data/powermem.db` and **LLM + embedding** env vars derived from OpenClaw. Typical `stateDir` is `~/.openclaw` unless the user uses another instance (`OPENCLAW_STATE_DIR`, `--workdir`).  
   - **Optional `envFile`:** Path to a PowerMem `.env` for extra tuning. If the file **exists**, `pmem` loads it; **OpenClaw-derived vars still override** the same keys when `useOpenClawModel` is true.  
   - **`useOpenClawModel: false`:** Disables injection; user must supply a **complete** PowerMem config via `.env` and/or environment variables.  
   - **Verify:** `pmem --version`. If the gateway does not inherit the venv, set **`pmemPath`** to the absolute path of `pmem`.

4. **HTTP path (enterprise / shared server)**  
   - Same **Python 3.10+** requirement as CLI; then `pip install powermem`, `.env` in server working directory, `powermem-server --host 0.0.0.0 --port 8000`.  
   - Check: `curl -s http://localhost:8000/api/v1/system/health`.

5. **Install the plugin**  
   `openclaw plugins install /path/to/memory-powermem`, or **`install.sh`** from [INSTALL.md](https://github.com/ob-labs/memory-powermem/blob/main/INSTALL.md).

6. **Configure OpenClaw**  

   **CLI — minimal (recommended, matches plugin defaults):**  
   Do **not** set `envFile` unless you need a file. Example:

   ```bash
   openclaw config set plugins.enabled true
   openclaw config set plugins.slots.memory memory-powermem
   openclaw config set plugins.entries.memory-powermem.config.mode cli
   openclaw config set plugins.entries.memory-powermem.config.pmemPath pmem
   openclaw config set plugins.entries.memory-powermem.config.useOpenClawModel true --json
   openclaw config set plugins.entries.memory-powermem.config.autoCapture true --json
   openclaw config set plugins.entries.memory-powermem.config.autoRecall true --json
   openclaw config set plugins.entries.memory-powermem.config.inferOnAdd true --json
   ```

   **CLI — optional `.env` override file:**

   ```bash
   openclaw config set plugins.entries.memory-powermem.config.envFile "$HOME/.openclaw/powermem/powermem.env"
   ```

   (Only matters if that path exists; OpenClaw can still override LLM keys when `useOpenClawModel` is true.)

   **HTTP:**

   ```bash
   openclaw config set plugins.entries.memory-powermem.config.mode http
   openclaw config set plugins.entries.memory-powermem.config.baseUrl http://localhost:8000
   ```

   Optional: `apiKey` if the server uses auth.

7. **Verify**  
   Restart **gateway**, then in another terminal:

   ```bash
   openclaw plugins list
   ```

   Confirm **memory-powermem** is listed and its status is **loaded**. If it is missing or not loaded, fix install/slot config and restart the gateway before running LTM checks.

   ```bash
   openclaw ltm health
   openclaw ltm add "I prefer coffee in the morning"
   openclaw ltm search "coffee"
   ```

## Available Tools

| Tool | Description |
|------|-------------|
| **memory_recall** | Search long-term memories. Params: `query`, optional `limit`, `scoreThreshold`. |
| **memory_store** | Save text; optional infer. Params: `text`, optional `importance`. |
| **memory_forget** | Delete by `memoryId` or by `query` search. |

## Configuration (summary)

| Field | Default | Description |
|-------|---------|-------------|
| `mode` | `cli` | `cli` or `http`. |
| `baseUrl` | — | Required for HTTP; if `mode` omitted and `baseUrl` set → HTTP. |
| `apiKey` | — | HTTP server auth. |
| `envFile` | — | Optional CLI `.env` (used only if file exists). |
| `pmemPath` | `pmem` | CLI binary path. |
| `useOpenClawModel` | `true` | Inject LLM/embedding from OpenClaw + default SQLite under state dir. |
| `recallLimit` | `5` | Max memories per recall. |
| `recallScoreThreshold` | `0` | Min score 0–1. |
| `autoCapture` / `autoRecall` / `inferOnAdd` | `true` | Auto memory pipeline and infer on add. |

## Daily Operations

```bash
openclaw gateway

openclaw ltm health
openclaw ltm add "Some fact to remember"
openclaw ltm search "query"

openclaw config set plugins.slots.memory none
openclaw config set plugins.slots.memory memory-powermem
```

Restart the gateway after slot or plugin config changes.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| **Python < 3.10** | Run step 2 first; upgrade Python or use `python3.11` / `python3.12` for venv and `pip install`. Do not skip the version check. |
| **`pip install powermem` fails** | Confirm Python 3.10+, clean venv. See [PowerMem issues](https://github.com/oceanbase/powermem/issues). |
| **`pmem` not found** | Activate venv or set **`pmemPath`** to the full binary. |
| **`openclaw ltm health` unhealthy (CLI)** | Confirm **`agents.defaults.model`** and provider keys in OpenClaw; gateway version should expose plugin **`config`** + **`runtime.modelAuth`**. Or set **`useOpenClawModel: false`** and a full **`envFile`**. |
| **Health OK but add/search errors** | Embedding/LLM mismatch for your provider—see gateway logs; try optional **PowerMem `.env`** from [.env.example](https://github.com/oceanbase/powermem/blob/master/.env.example). |
| **Wrong SQLite file / instance** | Data is under **that OpenClaw instance’s `stateDir`** (`OPENCLAW_STATE_DIR` / `--workdir`). |
| **HTTP mode** | Server running, **`baseUrl`** correct, **`apiKey`** if enabled. |
| **`openclaw plugins list`**: no `memory-powermem`, or status is not **loaded** | Re-run plugin install; set `plugins.enabled` true and `plugins.slots.memory` = `memory-powermem`; restart **gateway**; run `openclaw plugins list` again until **memory-powermem** shows **loaded**. |
