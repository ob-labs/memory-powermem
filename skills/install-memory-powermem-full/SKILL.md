---
name: install-memory-powermem-full
description: OpenClaw full guide skill (id and folder name install-memory-powermem-full). Step-by-step install and configuration for the PowerMem long-term memory plugin—default powermem-ts (npm) CLI, optional Python pmem, HTTP, tools, troubleshooting—and bundled reference docs. Complements install-memory-powermem; either can be used alone.
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

# PowerMem Memory — Full Guide

**Skill id / OpenClaw folder name:** `install-memory-powermem-full`. For the shortest install-only path, use **`install-memory-powermem`** (quickstart).

This skill folder includes supplementary docs:

- **powermem-intro.md** — What PowerMem is, features, vs file-based memory.
- **config-reference.md** — Config keys, state dir, commands.

## How It Works

- **Auto-Capture**: After a conversation, the plugin sends valuable user/assistant text to PowerMem (optional infer / intelligent extraction).
- **Auto-Recall**: Before each turn, it searches memories and can inject a `<relevant-memories>` block into context.
- **Auto-Experience**: Optionally distills procedural experiences and stores them as memories for later recall.

## When User Asks to Install

**Recommended order (TO C):** (1) OpenClaw installed and **default model + provider auth** configured. (2) Install the **memory-powermem** plugin. (3) Default **CLI** uses **powermem-ts** (npm package **`powermem`**) via **`pmemPath: bundled`**—no Python required; the plugin’s `npm install` / `pnpm install` pulls `powermem`, **`@langchain/openai`**, and native deps (**`better-sqlite3`**). (4) *Optional:* use **Python** `pmem` from [oceanbase/powermem](https://github.com/oceanbase/powermem) instead by setting **`pmemPath`** to the venv binary. **No `powermem.env` is required** for the default path when **`useOpenClawModel`** is true.

The curl **`install.sh`** deploys the plugin and OpenClaw entries; with **`-y`** it may still create **`~/.openclaw/powermem/powermem.env`** as an *optional* template—it does **not** require `pip install powermem`. That file is **not** required if the user relies on **OpenClaw-injected** LLM + default SQLite + **bundled** npm CLI.

1. **Check OpenClaw**  
   `openclaw --version`. If missing: `npm install -g openclaw`, `openclaw onboard`.  
   Ensure **`agents.defaults.model`** is set (e.g. `openai/gpt-4o-mini`) and the corresponding **provider / API key** works for normal chat—the plugin reuses that for PowerMem when **`useOpenClawModel`** is true (default).

2. **Install the plugin**  
   `openclaw plugins install /path/to/memory-powermem` (or `openclaw plugins install memory-powermem` from npm), or run **`install.sh`** from the [memory-powermem](https://github.com/ob-labs/memory-powermem) repo — see **One-click plugin deploy (`install.sh`)** below for curl / flags / `--workdir`.

3. **PowerMem CLI — default: powermem-ts (npm), no Python**  
   - Plugin default **`pmemPath: bundled`**: runs the **`powermem`** npm package (TypeScript / **powermem-ts**) shipped with the plugin (`node_modules/.../powermem/dist/cli.js`).  
   - After `openclaw plugins install` or **`install.sh`**, dependencies are installed under the plugin directory; for a **local path** / symlink install, run **`pnpm install` / `npm install`** in that directory.  
   - **pnpm 10+:** allow **`better-sqlite3`** install scripts (see plugin **`package.json`** → **`pnpm.onlyBuiltDependencies`**) or run **`pnpm rebuild better-sqlite3`** if the native module failed to build.  
   - **Defaults:** Plugin injects **SQLite** at `<OpenClaw stateDir>/powermem/data/powermem.db` and **LLM + embedding** env vars derived from OpenClaw. Typical `stateDir` is `~/.openclaw` unless the user uses another instance (`OPENCLAW_STATE_DIR`, `--workdir`).  
   - **Optional `envFile`:** Path to a PowerMem `.env` for extra tuning. If the file **exists**, `pmem` loads it; **OpenClaw-derived vars still override** the same keys when `useOpenClawModel` is true.  
   - **`useOpenClawModel: false`:** Disables injection; user must supply a **complete** PowerMem config via `.env` and/or environment variables.

4. **Optional: Python CLI instead of bundled npm**  
   For [oceanbase/powermem](https://github.com/oceanbase/powermem) **Python** `pmem`: **Python 3.10+**, venv + `pip install powermem`, then set **`pmemPath`** to the absolute path of the `pmem` binary (gateway may not inherit venv `PATH`). Verify with **`pmem --version`**.

5. **HTTP path (enterprise / shared server)**  
   - Run **`powermem-server`** from the same **powermem-ts** stack (npm) or from a Python/Docker deployment; `.env` in server working directory with DB + LLM + embedding; e.g. `powermem-server --host 0.0.0.0 --port 8000`.  
   - Check: `curl -s http://localhost:8000/api/v1/system/health` (or `/api/v2/system/health` for v2).

6. **Configure OpenClaw**  

   **CLI — defaults (recommended, matches plugin defaults):**  
   Do **not** set `envFile` unless you need a file. Example:

   ```bash
   openclaw config set plugins.enabled true
   openclaw config set plugins.slots.memory memory-powermem
   openclaw config set plugins.entries.memory-powermem.config.mode cli
   openclaw config set plugins.entries.memory-powermem.config.pmemPath bundled
   openclaw config set plugins.entries.memory-powermem.config.useOpenClawModel true --json
   openclaw config set plugins.entries.memory-powermem.config.autoCapture true --json
   openclaw config set plugins.entries.memory-powermem.config.autoRecall true --json
   openclaw config set plugins.entries.memory-powermem.config.autoExperience true --json
   openclaw config set plugins.entries.memory-powermem.config.experienceRecall true --json
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

   Optional: `apiKey` if the server uses auth. For v2, set:
   ```bash
   openclaw config set plugins.entries.memory-powermem.config.httpApiVersion v2
   openclaw config set plugins.entries.memory-powermem.config.requestConfig '{"memory_db":{"host":"db-host","port":2881}}' --json
   ```

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

## One-click plugin deploy (`install.sh`)

**Requires:** OpenClaw installed (`openclaw --version`). The script runs **`npm install`** (or equivalent) **inside the deployed plugin directory** so **powermem-ts** is available; it does **not** run `pip install powermem`. Default **`pmemPath`** is **`bundled`** (npm CLI).

**Default:** configures plugin **CLI** mode. With **`-y`**, it may still create **`~/.openclaw/powermem/powermem.env`** as an optional template — not required if you use OpenClaw-injected LLM + default SQLite + bundled CLI.

```bash
curl -fsSL https://raw.githubusercontent.com/ob-labs/memory-powermem/main/install.sh | bash
```

From a local clone (no download):

```bash
cd /path/to/memory-powermem && bash install.sh
```

Non-interactive (defaults: CLI, may seed env file):

```bash
curl -fsSL https://raw.githubusercontent.com/ob-labs/memory-powermem/main/install.sh | bash -s -y
```

Target a different OpenClaw instance:

```bash
curl -fsSL https://raw.githubusercontent.com/ob-labs/memory-powermem/main/install.sh | bash -s -- --workdir ~/.openclaw-second
```

**What the script does:** resolve OpenClaw workdir → choose or default **cli** / **http** and paths → for CLI, optionally seed `powermem.env` if missing → deploy plugin to `<workdir>/extensions/memory-powermem` → `npm install` there → set OpenClaw config (`plugins.enabled`, `slots.memory`, `entries.memory-powermem`).

**After (CLI):** `openclaw gateway`, then `openclaw ltm health` — you usually **do not** need to edit `powermem.env` when using plugin defaults.

**After (HTTP):** start PowerMem with a proper `.env` in the server cwd, then start the gateway.

## Copy a skill into OpenClaw

Copy **one** skill you want into `~/.openclaw/skills/<skill-name>/` (folder name should match the skill id). The quickstart and full-guide skills are **independent**.

**Quickstart (`install-memory-powermem`) — Linux / macOS:**

```bash
mkdir -p ~/.openclaw/skills/install-memory-powermem
cp /path/to/memory-powermem/skills/install-memory-powermem/SKILL.md \
   ~/.openclaw/skills/install-memory-powermem/
```

**Full guide (`install-memory-powermem-full`) — Linux / macOS:** copy **all** `.md` files in that folder.

```bash
mkdir -p ~/.openclaw/skills/install-memory-powermem-full
cp /path/to/memory-powermem/skills/install-memory-powermem-full/*.md \
   ~/.openclaw/skills/install-memory-powermem-full/
```

**Full guide — Windows (PowerShell):**

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.openclaw\skills\install-memory-powermem-full"
Copy-Item "path\to\memory-powermem\skills\install-memory-powermem-full\*.md" `
  "$env:USERPROFILE\.openclaw\skills\install-memory-powermem-full\"
```

## Multi-instance OpenClaw (`--workdir` / `OPENCLAW_STATE_DIR`)

**Install script:**

```bash
curl -fsSL https://raw.githubusercontent.com/ob-labs/memory-powermem/main/install.sh | bash -s -- --workdir ~/.openclaw-second
```

**Manual config** for that instance:

```bash
OPENCLAW_STATE_DIR=~/.openclaw-second openclaw config set plugins.slots.memory memory-powermem
```

Plugin data and default SQLite follow **that** instance’s `stateDir`.

## Available Tools

| Tool | Description |
|------|-------------|
| **memory_recall** | Search long-term memories. Params: `query`, optional `limit`, `scoreThreshold`. |
| **memory_store** | Save text; optional infer. Params: `text`, optional `importance`. |
| **memory_forget** | Delete by `memoryId` or by `query` search. |
| **experience_store** | Store a procedural experience. |
| **experience_recall** | Recall experiences. |
| **agent_memory_add** | Add memory to another agent (HTTP v2 only). |
| **agent_memory_list** | List an agent’s memories (HTTP v2 only). |
| **agent_memory_share** | Share memories across agents (HTTP v2 only). |
| **agent_memory_shared** | List memories shared with an agent (HTTP v2 only). |

## Configuration (summary)

| Field | Default | Description |
|-------|---------|-------------|
| `mode` | `cli` | `cli` or `http`. |
| `baseUrl` | — | Required for HTTP; if `mode` omitted and `baseUrl` set → HTTP. |
| `apiKey` | — | HTTP server auth. |
| `httpApiVersion` | `v1` | HTTP API version: `v1` or `v2`. |
| `requestConfig` | — | HTTP v2: per-request config (e.g. `memory_db`). |
| `envFile` | — | Optional CLI `.env` (used only if file exists). |
| `pmemPath` | `bundled` | CLI: **`bundled`** = npm **powermem-ts** next to the plugin; **`auto`** / empty resolves bundled then falls back to **`pmem` on PATH** (e.g. Python); or an absolute path to a `pmem` executable. |
| `useOpenClawModel` | `true` | Inject LLM/embedding from OpenClaw + default SQLite under state dir. |
| `recallLimit` | `5` | Max memories per recall. |
| `recallScoreThreshold` | `0` | Min score 0–1. |
| `autoCapture` / `autoRecall` / `autoExperience` / `experienceRecall` / `inferOnAdd` | `true` | Auto memory + experience pipeline and infer on add. |
| `userId` / `agentId` | auto | Omit or set to `auto` to generate stable IDs saved under `<stateDir>/powermem/identity.json`. |
| `dualWrite` | `false` | HTTP only: remote + local SQLite dual-write. |
| `localDbPath` | — | Local SQLite path for dual-write. |
| `localUserId` / `localAgentId` | — | Local namespace for dual-write (defaults to `userId`/`agentId`). |
| `syncOnResume` / `syncBatchSize` / `syncMinIntervalMs` / `syncBaseDelayMs` / `syncMaxDelayMs` / `syncMaxRetries` | see defaults | Retry controls for pending sync. |

## Daily Operations

```bash
openclaw gateway restart

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
| **`spawnSync pmem ENOENT` / bundled CLI not resolved** | Run **`pnpm install` / `npm install`** in the plugin directory; ensure **`pmemPath`** is **`bundled`** or points to a real **`powermem/dist/cli.js`**. |
| **`ERR_MODULE_NOT_FOUND` (e.g. `@langchain/openai`)** | Ensure plugin **`package.json`** dependencies are installed (**memory-powermem** lists **`@langchain/openai`** for optional peers of **powermem**). |
| **`better-sqlite3` failed to load** | **`pnpm rebuild better-sqlite3`** or allow build scripts per **`pnpm.onlyBuiltDependencies`** in the plugin **`package.json`**. |
| **Python path only:** **Python < 3.10** or **`pip install powermem` fails** | Upgrade Python / clean venv. See [oceanbase/powermem](https://github.com/oceanbase/powermem/issues). |
| **`pmem` not found** (PATH / Python) | Set **`pmemPath`** to the venv **`pmem`** absolute path, or use **`bundled`**. |
| **`openclaw ltm health` unhealthy (CLI)** | Confirm **`agents.defaults.model`** and provider keys in OpenClaw; gateway version should expose plugin **`config`** + **`runtime.modelAuth`**. Or set **`useOpenClawModel: false`** and a full **`envFile`**. |
| **Health OK but add/search errors** | Embedding/LLM mismatch for your provider—see gateway logs; try optional **PowerMem `.env`** from [.env.example](https://github.com/oceanbase/powermem/blob/master/.env.example). |
| **Wrong SQLite file / instance** | Data is under **that OpenClaw instance’s `stateDir`** (`OPENCLAW_STATE_DIR` / `--workdir`). |
| **HTTP mode** | Server running, **`baseUrl`** correct, **`apiKey`** if enabled. |
| **`openclaw plugins list`**: no `memory-powermem`, or status is not **loaded** | Re-run plugin install; set `plugins.enabled` true and `plugins.slots.memory` = `memory-powermem`; restart **gateway**; run `openclaw plugins list` again until **memory-powermem** shows **loaded**. |
| **Add/search returns 500 or empty** | Check PowerMem / gateway logs; often missing or mismatched **`LLM_*` / `EMBEDDING_*`** in **`envFile`** when **`useOpenClawModel`** is false or overrides are incomplete. |
