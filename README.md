<p align="center">

*[PowerMem](https://github.com/oceanbase/powermem) + [OpenClaw](https://github.com/openclaw/openclaw): maximum token savings for AI agents.*

<img src="docs/images/openclaw_powermem.jpeg" alt="PowerMem with OpenClaw" width="900"/>

</p>

# OpenClaw Memory (PowerMem) Plugin

This plugin lets [OpenClaw](https://github.com/openclaw/openclaw) use long-term memory via [PowerMem](https://github.com/oceanbase/powermem): intelligent extraction, Ebbinghaus forgetting curve, multi-agent isolation. Supports HTTP v2 (per-request config + agent memory sharing), LLM-based experience extraction, and optional dual-write to local SQLite.

**Default:** **CLI mode** — the plugin runs `pmem` locally (no `powermem-server`). Use **HTTP mode** when you already run a shared PowerMem API (teams / enterprise).

Follow the steps in order: install PowerMem, then install the plugin, configure OpenClaw (defaults work for CLI + `~/.openclaw/powermem/powermem.env`), and verify.

---

## Prerequisites

- **OpenClaw** installed (CLI + gateway working)
- **PowerMem** installed (`pip install powermem`) with `pmem` available — either on PATH when you start the gateway, or via absolute `pmemPath` in plugin config
- **`.env` for PowerMem** with at least database + LLM + Embedding (see [PowerMem `.env.example`](https://github.com/oceanbase/powermem/blob/master/.env.example)); for individuals, prefer `~/.openclaw/powermem/powermem.env` and SQLite

---

## Step 1: Install and start PowerMem

Choose **Option A (CLI, recommended for OpenClaw individuals)**, **Option B (HTTP + pip)**, or **Option C (Docker)**.

### Option A: CLI + SQLite (recommended for individuals)

No HTTP server. Matches the plugin’s **default** (`mode: cli`).

1. **Install PowerMem** (venv recommended):

   ```bash
   python3 -m venv ~/.openclaw/powermem/.venv
   source ~/.openclaw/powermem/.venv/bin/activate
   pip install powermem
   ```

2. **Config** — From a clone of this repo, run `bash install.sh` (or the curl one-liner under **Install options** below) to create an optional `~/.openclaw/powermem/powermem.env` template, or copy from PowerMem’s `.env.example`. Set `LLM_*` and `EMBEDDING_*` when not relying on OpenClaw-injected models.

3. If `pmem` exists only inside the venv, set `pmemPath` in the plugin `config` to the absolute path of `pmem` in that venv.

4. **Verify** — With venv activated: `pmem --version`. After gateway start: `openclaw ltm health`.

---

### Option B: Install with pip (run HTTP server locally)

Use this when you want a **standalone API** or are not using CLI mode. Best if you already have Python 3.11+ on the machine.

**1. Install PowerMem**

```bash
pip install powermem
```

**2. Prepare config**

In **any directory** where you want to keep config (e.g. `~/powermem`):

```bash
mkdir -p ~/powermem && cd ~/powermem
# Copy from PowerMem repo: if you cloned it, run: cp /path/to/powermem/.env.example .env
```

If you did not clone the PowerMem repo, create a `.env` with at least: database + LLM + Embedding. Here is a **minimal working example** (OceanBase + Qwen; replace with your API key and DB credentials):

```bash
# Create .env in ~/powermem (replace your_api_key_here and your_password)
cat > .env << 'EOF'
TIMEZONE=Asia/Shanghai
DATABASE_PROVIDER=oceanbase

OCEANBASE_HOST=127.0.0.1
OCEANBASE_PORT=2881
OCEANBASE_USER=root@sys
OCEANBASE_PASSWORD=your_password
OCEANBASE_DATABASE=powermem
OCEANBASE_COLLECTION=memories

LLM_PROVIDER=qwen
LLM_API_KEY=your_api_key_here
LLM_MODEL=qwen-plus

EMBEDDING_PROVIDER=qwen
EMBEDDING_API_KEY=your_api_key_here
EMBEDDING_MODEL=text-embedding-v4
EMBEDDING_DIMS=1536
EOF
```

Replace `your_api_key_here` with your Tongyi Qwen API key (and set `your_password` and other DB fields as needed for OceanBase). For OpenAI or other providers, see PowerMem’s [.env.example](https://github.com/oceanbase/powermem/blob/master/.env.example) for `LLM_*` and `EMBEDDING_*`.

**3. Start the HTTP server**

Run this **in the same directory as `.env`**:

```bash
cd ~/powermem   # or wherever .env lives
powermem-server --host 0.0.0.0 --port 8000
```

You should see something like `Uvicorn running on http://0.0.0.0:8000`. Leave this terminal open.

**4. Verify PowerMem**

In a new terminal:

```bash
curl -s http://localhost:8000/api/v1/system/health
```

If you get JSON (e.g. with `"status":"healthy"`), PowerMem is ready.

---

### Option C: Run with Docker (no Python needed)

Best if you have Docker and prefer not to install Python.

**1. Clone PowerMem and prepare .env**

```bash
git clone https://github.com/oceanbase/powermem.git
cd powermem
cp .env.example .env
```

Edit `.env` and set at least:

- `LLM_API_KEY`, `LLM_PROVIDER`, `LLM_MODEL`
- `EMBEDDING_API_KEY`, `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`

Database: OceanBase is recommended.

**2. Start the container**

From the **powermem project root** (same level as `.env`):

```bash
docker-compose -f docker/docker-compose.yml up -d
```

**3. Verify**

```bash
curl -s http://localhost:8000/api/v1/system/health
```

JSON response means the server is up. API docs: `http://localhost:8000/docs`.

---

## Install options

- **One-click (Linux/macOS):**  
  ```bash
  curl -fsSL https://raw.githubusercontent.com/ob-labs/memory-powermem/main/install.sh | bash
  ```  
  From a clone: `cd /path/to/memory-powermem && bash install.sh`. Non-interactive: same URL but pipe to `bash -s -y`. Another OpenClaw instance: `bash -s -- --workdir ~/.openclaw-second`. Details and troubleshooting: OpenClaw skill **`install-memory-powermem-full`** ([skills/install-memory-powermem-full/](skills/install-memory-powermem-full/)).
- **OpenClaw skill — quickstart (`install-memory-powermem`):** Copy [skills/install-memory-powermem/SKILL.md](skills/install-memory-powermem/SKILL.md) to `~/.openclaw/skills/install-memory-powermem/`, then say **「PowerMem 快速安装」** / **“PowerMem quickstart”** or **“Minimal install memory-powermem”** / **“Install memory powermem minimal”**.  
- **OpenClaw skill — full guide (`install-memory-powermem-full`):** Copy [skills/install-memory-powermem-full/SKILL.md](skills/install-memory-powermem-full/SKILL.md) (and its sibling `.md` files in that folder if you mirror the repo) to `~/.openclaw/skills/install-memory-powermem-full/`, then say **「安装 PowerMem 记忆」** / **“Install PowerMem memory”**. The quickstart and full-guide skills are **independent**; use whichever fits your workflow.
- **Manual:** Steps below.

---

## Step 2: Install the plugin into OpenClaw

On your machine (use your actual plugin path):

```bash
# Install from npm (recommended for end users; downloads and installs from the official npm registry)
openclaw plugins install memory-powermem

# Install from a local directory (e.g. cloned repo)
openclaw plugins install /path/to/memory-powermem

# For development (symlink, no copy)
openclaw plugins install -l /path/to/memory-powermem
```

**Note:** Running `npm i memory-powermem` in a Node project only adds the package to that project’s `node_modules`; it does **not** register the plugin with OpenClaw. To use this as an OpenClaw plugin, you must run `openclaw plugins install memory-powermem` (or install from a path as above), then restart the gateway.

After install, run `openclaw plugins list` and confirm `memory-powermem` is listed. With **no** `plugins.entries["memory-powermem"].config`, the plugin uses **defaults**: `mode: "cli"`, `pmemPath: "bundled"` (npm `powermem` from plugin dependencies), `useOpenClawModel: true` (SQLite under OpenClaw state + LLM from `agents.defaults.model`), plus `autoCapture` / `autoRecall` / `inferOnAdd` enabled. No separate `powermem.env` is required unless you opt out of OpenClaw model injection.

---

## Step 3: Configure OpenClaw (optional)

If you use **CLI mode** with defaults (`bundled` + OpenClaw model injection), you can skip this step. Customize for HTTP, a different URL/API key, Python `pmem` (`pmemPath: "auto"` or an absolute path), or a `powermem` `.env` via `envFile`.

**CLI (default):**

```json
{
  "plugins": {
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

**HTTP (shared server):**

```json
"config": {
  "mode": "http",
  "baseUrl": "http://localhost:8000",
  "httpApiVersion": "v2",
  "requestConfig": { "memory_db": { "host": "db-host", "port": 2881 } },
  "autoCapture": true,
  "autoRecall": true,
  "autoExperience": true,
  "experienceRecall": true,
  "inferOnAdd": true
}
```

Notes:

- **CLI (default):** You may omit `mode` and use CLI when `baseUrl` is empty. Default `pmemPath` is `bundled` (npm CLI). Use `envFile` and/or `pmemPath` when you need a custom setup.
- **HTTP:** When `mode` is `http`, `baseUrl` is required; if you set `baseUrl` without `mode`, the plugin treats it as HTTP. Do **not** append `/api/v1` to `baseUrl`. If the server uses API key auth, add `"apiKey"`.
- **Restart the OpenClaw gateway** (or Mac menubar app) after changing config.

---

## Step 4: Verify plugin and PowerMem connection

In a terminal:

```bash
# Check whether PowerMem is reachable
openclaw ltm health
```

If there are no errors and you see a healthy status, the plugin is talking to PowerMem.

Then try a manual add and search:

```bash
# Add a memory
openclaw ltm add "I prefer a cup of Americano every morning"

# Search by content
openclaw ltm search "coffee"
```

If search returns what you just added (or similar content), the full flow (install PowerMem → install plugin → configure OpenClaw) is working end to end.

---

## OpenClaw plugin commands (reference)

Common CLI commands for managing plugins:

| Command | Description |
|---------|-------------|
| `openclaw plugins list` | List installed plugins; confirm `memory-powermem` is listed. Use `--json` for machine-readable output. |
| `openclaw plugins info <id>` | Show details for a plugin (e.g. `openclaw plugins info memory-powermem`). |
| `openclaw plugins uninstall <id>` | Remove the plugin (e.g. `openclaw plugins uninstall memory-powermem`). Use `--keep-files` to leave files on disk. |
| `openclaw plugins enable <id>` | Enable a disabled plugin. |
| `openclaw plugins disable <id>` | Disable a plugin without uninstalling. |
| `openclaw plugins doctor` | Diagnose plugin load and configuration issues. |
| `openclaw plugins update <id>` | Update a plugin installed from npm. Use `openclaw plugins update --all` to update all. |

After installing, uninstalling, or changing config, restart the OpenClaw gateway for changes to take effect.

---

## Config options (optional)

| Option        | Required | Description |
|---------------|----------|-------------|
| `mode` | No | Backend: `"cli"` (default) or `"http"`. If omitted, non-empty `baseUrl` implies `http`. |
| `baseUrl` | Yes (http) | PowerMem API base URL when `mode` is `http`, e.g. `http://localhost:8000`, no `/api/v1` suffix. |
| `apiKey` | No | Set when PowerMem server has API key authentication enabled (http mode). |
| `httpApiVersion` | No | HTTP API version: `"v1"` (default) or `"v2"`. |
| `requestConfig` | No | HTTP v2 only: forwarded as `config` in each request (e.g. `memory_db` settings). |
| `envFile` | No | CLI: path to PowerMem `.env` (default when using plugin defaults: `~/.openclaw/powermem/powermem.env`). |
| `pmemPath` | No | CLI: `bundled` (default), `auto`, or path/command for `pmem`. |
| `userId` | No | User isolation (multi-user). If omitted or set to `"auto"`, a stable ID is generated and stored in `<stateDir>/powermem/identity.json`. |
| `agentId` | No | Agent isolation (multi-agent). If omitted or set to `"auto"`, a stable ID is generated and stored in `<stateDir>/powermem/identity.json`. |
| `autoCapture` | No | Auto-store from conversations after agent ends; default `true`. |
| `autoRecall` | No | Auto-inject relevant memories before agent starts; default `true`. |
| `autoExperience` | No | Auto-extract procedural experiences via LLM; default `true`. |
| `experienceRecall` | No | Include experiences in recall results; default `true`. |
| `inferOnAdd` | No | Use PowerMem intelligent extraction when adding; default `true`. |
| `dualWrite` | No | HTTP only: write to remote + local SQLite and queue failed writes. |
| `dualWritePriority` | No | Dual-write priority: `"remote"` (default) tries PowerMem first and falls back to local SQLite; `"local"` writes/searches SQLite first and syncs to remote. |
| `localDbPath` | No | Local SQLite path for `dualWrite`. |
| `localUserId` | No | Local namespace for `dualWrite` (defaults to `userId`). |
| `localAgentId` | No | Local namespace for `dualWrite` (defaults to `agentId`). |
| `syncOnResume` | No | Whether to sync pending writes on startup; default `true`. |
| `syncBatchSize` | No | Pending sync batch size; default `50`. |
| `syncMinIntervalMs` | No | Minimum interval between sync attempts; default `5000`. |
| `syncBaseDelayMs` | No | Base delay for retry backoff; default `5000`. |
| `syncMaxDelayMs` | No | Max delay for retry backoff; default `60000`. |
| `syncMaxRetries` | No | Max retry count per pending item; default `10`. |

**Memory partitioning and sharing:** Use `userId` / `agentId` for logical isolation. In HTTP v2, `agent_memory_share` supports cross-agent sharing within the same `userId`; use `cross_scope_share` when you need to copy memories across both `userId` and `agentId` scopes.

**Auto-capture:** When a session ends, this round’s user/assistant text is sent to PowerMem (`infer: true`) for extraction and storage. At most 3 items per round, each up to about 6000 characters.

---

## Agent tools

Exposed to OpenClaw agents:

- **memory_recall** — Search long-term memories by query.
- **memory_store** — Store one memory (optional intelligent extraction on write).
- **memory_forget** — Delete by memory ID or by search query.
- **experience_store** — Store a procedural experience.
- **experience_recall** — Search stored experiences.
- **agent_memory_add** — Add memory to another agent (HTTP v2 only).
- **agent_memory_list** — List an agent’s memories (HTTP v2 only).
- **agent_memory_share** — Share memories across agents (HTTP v2 only).
- **agent_memory_shared** — List memories shared with an agent (HTTP v2 only).
- **cross_scope_share** — Copy memories across `userId`/`agentId` scopes (HTTP v2 only). Parameters: `fromUserId`, `fromAgentId`, `toUserId`, `toAgentId`, `query`; optional `limit`, `scoreThreshold`, `inferOnTarget`.

---

## OpenClaw CLI (when plugin enabled)

- `openclaw ltm search <query> [--limit n]` — Search memories.
- `openclaw ltm health` — Check PowerMem service health.
- `openclaw ltm add "<text>"` — Manually store one memory.

---

## Troubleshooting

**1. `openclaw ltm health` fails or cannot connect**

- **CLI:** npm `powermem` installed with the plugin (`bundled`), or correct `pmemPath`; optional `.env` at `envFile` if not using OpenClaw model injection.
- **HTTP:** PowerMem is running (HTTP server in a terminal, or Docker); `baseUrl` is correct (e.g. `http://localhost:8000`; watch for `127.0.0.1` vs `localhost` mismatches).
- Remote server: use the host IP or hostname instead of `localhost`.

**2. Add/search returns nothing or 500**

- Check PowerMem terminal or Docker logs; often LLM/Embedding not configured or wrong API key.
- Ensure `LLM_API_KEY` and `EMBEDDING_API_KEY` in `.env` are set and valid.

**3. Plugin installed but OpenClaw not using memory**

- Confirm `plugins.slots.memory` is `memory-powermem` and `plugins.entries["memory-powermem"].enabled` is `true`.
- Restart the gateway (or OpenClaw app) after config changes.

**4. Agent does not search memory until I ask it to**

- With `autoRecall: true`, the plugin injects system guidance so the agent is told to use `memory_recall` (or injected `<relevant-memories>`) when answering about past events, preferences, or people. Ensure `autoRecall` is not set to `false`.
- Auto-recall runs before each turn using the current user message (or the previous user message if the prompt is very short). If the agent still replies without querying memory, try saying explicitly once “check memory for …” to confirm the pipeline; ensure the Web session after `/new` uses the same gateway and plugin.

**5. Agent tries to read `memory/YYYY-MM-DD.md` and gets ENOENT**

- OpenClaw's built-in **session-memory** hook writes session snapshots to workspace `memory/YYYY-MM-DD-slug.md`. When you use PowerMem as the memory slot, the agent may still be told (by workspace docs or inference) to load those files, causing failed `read` calls. Disable the hook so only PowerMem is used: run `openclaw hooks disable session-memory`, or set `hooks.internal.entries["session-memory"].enabled` to `false` in `~/.openclaw/openclaw.json`. Restart the gateway after changing config.

---

## Development

```bash
cd /path/to/memory-powermem
pnpm install
pnpm lint   # type-check
pnpm test   # run tests (if any)
```

---

## License

Apache License 2.0. See [LICENSE](LICENSE).
