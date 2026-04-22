# Config & Commands Quick Reference

Quick reference for skill **`install-memory-powermem-full`**. See **SKILL.md** in this folder for the full install flow.

---

## Before the plugin: PowerMem CLI (default = powermem-ts)

- **Default (recommended)** — Plugin **`pmemPath: bundled`**: **powermem-ts** via npm package **`powermem`** inside the plugin directory. Run **`pnpm install` / `npm install`** in the plugin folder when installing from a **local path** or **`-l`** symlink. Dependencies include **`@langchain/openai`** (for optional peers) and **`better-sqlite3`** (native; **pnpm 10+** may require **`pnpm.onlyBuiltDependencies`** / **`pnpm rebuild better-sqlite3`**).
- **CLI (default)** — No `powermem.env` required for the default setup: the plugin injects **SQLite** (under the OpenClaw **state directory**) and **LLM + embedding** from OpenClaw (`agents.defaults.model` + provider keys), as long as `useOpenClawModel` is `true` (default).
- **Optional: Python `pmem`** — **Python 3.10+**, `pip install powermem` ([oceanbase/powermem](https://github.com/oceanbase/powermem)), then set **`pmemPath`** to the venv **`pmem`** absolute path (gateway often does not inherit venv `PATH`).
- **Optional `.env`** — Set `envFile` to a PowerMem `.env` if you want file-based overrides; if the file exists, it is loaded first, then OpenClaw-derived variables **override** the same keys (when `useOpenClawModel` is true).
- **HTTP (shared server)** — Run **`powermem-server`** (npm or Python/Docker); plugin `mode: http` + `baseUrl`. Use `httpApiVersion: v2` + `requestConfig` for per-request config. Verify with `curl` on `/api/v1/system/health` or v2 `/api/v2/system/health`.

---

## OpenClaw requirements (CLI + auto LLM)

- Configure **`agents.defaults.model`** (e.g. `openai/gpt-4o-mini`) and provider credentials in **`models.providers`** (and/or auth the way you normally do for the gateway).
- Gateway should expose plugin **`api.config`** and **`api.runtime.modelAuth`** (recent OpenClaw releases, e.g. 2026.3.x). If those are missing, rely on a full **`envFile`** or set **`useOpenClawModel: false`** and supply `LLM_*` / `EMBEDDING_*` yourself.

---

## SQLite data location (CLI, default)

- **`<stateDir>/powermem/data/powermem.db`**, where `stateDir` is from OpenClaw (`resolveStateDir`), typically `~/.openclaw` unless `OPENCLAW_STATE_DIR` / `--workdir` points elsewhere.

---

## Installing PowerMem vs installing the plugin

- **Default:** Install **memory-powermem** first; **powermem-ts** comes as a **dependency** of the plugin—**no** separate `pip install` for CLI mode.
- **Python-only CLI path:** `pip install powermem` (prefer a virtualenv), then configure **`pmemPath`** to that `pmem` binary.
- **HTTP mode**: Create a `.env` (see PowerMem / powermem-ts docs), set at least database + LLM + Embedding. Start server in that directory: `powermem-server --port 8000`. Verify: `curl -s http://localhost:8000/api/v1/system/health`.
- **CLI mode (Python):** Ensure `pmem` is on PATH or set **`pmemPath`** to an absolute path. Optional: `pmem config init` for `.env`.

---

## Plugin configuration

| Key | Default | Description |
|-----|---------|-------------|
| `mode` | `cli` | `cli` (local `pmem`) or `http` (`powermem-server`). |
| `baseUrl` | — | Required when `mode` is `http` (or omit `mode` and set non-empty `baseUrl` → HTTP). |
| `apiKey` | — | HTTP: optional PowerMem server API key. |
| `httpApiVersion` | `v1` | HTTP API version: `v1` or `v2`. |
| `requestConfig` | — | HTTP v2 only: forwarded as `config` (e.g. `memory_db`). |
| `envFile` | — | CLI: optional path to PowerMem `.env` (only used if the file exists). |
| `pmemPath` | `bundled` | CLI: **`bundled`** = npm **powermem-ts** next to the plugin; **`auto`** / empty = resolve bundled then **`pmem` on PATH**; or absolute path to a `pmem` executable (e.g. Python venv). |
| `useOpenClawModel` | `true` | Inject LLM/embedding from OpenClaw; default SQLite under state dir. Set `false` to disable injection (you must then provide a full `.env` or env vars). |
| `recallLimit` | `5` | Max memories per recall / auto-recall. |
| `recallScoreThreshold` | `0` | Min score (0–1) to keep a hit. |
| `autoCapture` | `true` | Auto-store from conversations. |
| `autoRecall` | `true` | Auto-inject relevant memories before reply. |
| `autoExperience` | `true` | Auto-extract experiences via LLM. |
| `experienceRecall` | `true` | Include experiences in recall. |
| `inferOnAdd` | `true` | PowerMem intelligent extraction on add. |
| `userId` | auto | Omit or set to `auto` to generate a stable ID saved under `<stateDir>/powermem/identity.json`. |
| `agentId` | auto | Omit or set to `auto` to generate a stable ID saved under `<stateDir>/powermem/identity.json`. |
| `dualWrite` | `false` | HTTP only: remote + local SQLite dual-write. |
| `localDbPath` | — | Local SQLite path for dual-write. |
| `localUserId` | — | Local namespace for dual-write (defaults to `userId`). |
| `localAgentId` | — | Local namespace for dual-write (defaults to `agentId`). |
| `localVector` | — | Optional local vector search for dual-write fallback (OpenAI/Ollama embeddings + sqlite-vec). |
| `syncOnResume` | `true` | Sync pending writes on startup. |
| `syncBatchSize` | `50` | Batch size for sync. |
| `syncMinIntervalMs` | `5000` | Minimum sync interval. |
| `syncBaseDelayMs` | `5000` | Base retry delay. |
| `syncMaxDelayMs` | `60000` | Max retry delay. |
| `syncMaxRetries` | `10` | Max retries per item. |

**`localVector` fields (optional):**

```json
{
  "localVector": {
    "enabled": true,
    "provider": "openai",
    "model": "text-embedding-3-small",
    "apiKey": "YOUR_KEY",
    "baseUrl": "https://api.openai.com",
    "headers": { "X-Org": "..." }
  }
}
```

- If `localVector` is omitted and `dualWrite: true`, the plugin attempts to reuse **OpenClaw** `agents.*.memorySearch` provider/model; otherwise defaults to OpenAI (`text-embedding-3-small`).  
- If embedding auth is unavailable, it automatically falls back to local **FTS/token** search.  

---

## Common OpenClaw commands

```bash
openclaw ltm health
openclaw ltm add "Something to remember"
openclaw ltm search "query"

openclaw config set plugins.slots.memory none
openclaw config set plugins.slots.memory memory-powermem
```

Restart the gateway after changing plugin or memory-slot config.

---

## Example `openclaw.json` fragments (manual edit)

Prefer `openclaw config set` when possible; use these when editing **`~/.openclaw/openclaw.json`** (or your instance’s config) directly. Replace paths with the user’s home / real `pmem` binary path.

**CLI mode (explicit `envFile`; optional when using OpenClaw-injected LLM + defaults):**

```json
{
  "plugins": {
    "enabled": true,
    "slots": { "memory": "memory-powermem" },
    "entries": {
      "memory-powermem": {
        "enabled": true,
        "config": {
          "mode": "cli",
          "envFile": "/home/you/.openclaw/powermem/powermem.env",
          "pmemPath": "bundled",
          "autoCapture": true,
          "autoRecall": true,
          "inferOnAdd": true
        }
      }
    }
  }
}
```

Default **`pmemPath`** is **`bundled`** (npm **powermem-ts**). If you use **Python** `pmem` inside a venv only, set **`pmemPath`** to that binary’s absolute path. With **`useOpenClawModel: true`** and no need for a file, you can omit **`envFile`** (see **SKILL.md** for the recommended `openclaw config set` flow).

**HTTP mode (shared server):**

```json
"config": {
  "mode": "http",
  "baseUrl": "http://localhost:8000",
  "autoCapture": true,
  "autoRecall": true,
  "inferOnAdd": true
}
```

If you omit **`mode`** but set a non-empty **`baseUrl`**, the plugin treats the backend as **http** (backward compatible). Add **`apiKey`** when the server requires it.
