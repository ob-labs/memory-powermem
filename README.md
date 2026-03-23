<p align="center">

*[PowerMem](https://github.com/oceanbase/powermem) + [OpenClaw](https://github.com/openclaw/openclaw): maximum token savings for AI agents.*

<img src="docs/images/openclaw_powermem.jpeg" alt="PowerMem with OpenClaw" width="900"/>

</p>

# OpenClaw Memory (PowerMem) Plugin

This plugin lets [OpenClaw](https://github.com/openclaw/openclaw) use long-term memory via [PowerMem](https://github.com/oceanbase/powermem): intelligent extraction, Ebbinghaus forgetting curve, multi-agent isolation.

**Default:** **CLI mode** — the plugin runs `pmem` locally (no `powermem-server`). Use **HTTP mode** when you already run a shared PowerMem API (teams / enterprise).

Follow the steps in order: install PowerMem, then install the plugin, configure OpenClaw (defaults work for CLI + `~/.openclaw/powermem/powermem.env`), and verify.

---

## Prerequisites

- **OpenClaw** installed (CLI + gateway working)
- **PowerMem** installed (`pip install powermem`) with `pmem` available — either on PATH when you start the gateway, or via absolute `pmemPath` in plugin config
- **`.env` for PowerMem** with at least database + LLM + Embedding (see [PowerMem `.env.example`](https://github.com/oceanbase/powermem/blob/master/.env.example)); for individuals, prefer `~/.openclaw/powermem/powermem.env` and SQLite

---

## Step 1: Install and start PowerMem

Choose **Option C (CLI, recommended for OpenClaw)** or **Option A (HTTP / pip)** or **Option B (Docker)**.

### Option C: CLI + SQLite (recommended for individuals)

No HTTP server. Matches the plugin’s **default** (`mode: cli`).

1. **Install PowerMem** (venv recommended):

   ```bash
   python3 -m venv ~/.openclaw/powermem/.venv
   source ~/.openclaw/powermem/.venv/bin/activate
   pip install powermem
   ```

2. **Config** — Use [INSTALL.md](INSTALL.md) one-liner `install.sh` to create `~/.openclaw/powermem/powermem.env` (SQLite template), or copy from PowerMem’s `.env.example`. Set `LLM_*` and `EMBEDDING_*`.

3. **Plugin / OpenClaw** — After installing the plugin, either leave the default config (CLI + default `envFile` under `~/.openclaw/powermem/`) or set `envFile` / `pmemPath` explicitly if `pmem` is only inside the venv.

4. **Verify** — With venv activated: `pmem --version`. After gateway start: `openclaw ltm health`.

---

### Option A: HTTP server with pip

Choose this for a **standalone API** or when not using CLI mode.

### Option A: Install with pip (run server locally)

Best if you already have Python 3.11+.

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

Replace `your_api_key_here` with your Qwen API key and `your_password` with your OceanBase password. For SQLite (simplest local setup). For OpenAI or others, see PowerMem’s [.env.example](https://github.com/oceanbase/powermem/blob/master/.env.example) for `LLM_*` and `EMBEDDING_*`.

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

### Option B: Run with Docker (no Python needed)

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

Database can stay default; OceanBase is recommended (see .env.example).

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

- **One-click (Linux/macOS):** See [INSTALL.md](INSTALL.md) for `install.sh` (curl or run from repo root).
- **Let OpenClaw install it (simplest):** Copy [skills/powermem-memory-quickstart/SKILL.md](skills/powermem-memory-quickstart/SKILL.md) to `~/.openclaw/skills/powermem-memory-quickstart/`, then say **「PowerMem 快速安装」** or **“PowerMem quickstart”**.  
- **Full skill (options + troubleshooting):** [skills/install-powermem-memory/SKILL.md](skills/install-powermem-memory/SKILL.md) → **「安装 PowerMem 记忆」** / **“Install PowerMem memory”**.
- **Manual:** Steps below.

---

## Step 2: Install the plugin into OpenClaw

On your machine (use your actual plugin path):

```bash
# Install from npm (recommended for end users; OpenClaw downloads the package from the npm registry)
openclaw plugins install memory-powermem

# Install from a local directory (e.g. cloned repo)
openclaw plugins install /path/to/memory-powermem

# For development (symlink, no copy)
openclaw plugins install -l /path/to/memory-powermem
```

**Note:** Running `npm i memory-powermem` in a Node project only adds the package to that project’s `node_modules`; it does **not** register the plugin with OpenClaw. To use this as an OpenClaw plugin, you must run `openclaw plugins install memory-powermem` (or install from a path as above), then restart the gateway.

After install, run `openclaw plugins list` and confirm `memory-powermem` is listed. With **no** `plugins.entries["memory-powermem"].config`, the plugin uses **defaults**: `mode: "cli"`, `envFile` under `~/.openclaw/powermem/powermem.env`, `pmemPath: "pmem"`, plus `autoCapture` / `autoRecall` / `inferOnAdd` enabled. Ensure `pmem` is on PATH (or set `pmemPath`) and the env file exists and is valid.

---

## Step 3: Configure OpenClaw (optional)

If you use **CLI mode** with the default paths and `pmem` on PATH, you can skip this step. Customize for HTTP, a different URL/API key, or a non-default `envFile` / `pmemPath`.

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
          "pmemPath": "pmem",
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
  "autoCapture": true,
  "autoRecall": true,
  "inferOnAdd": true
}
```

Notes:

- **CLI (default):** `mode` optional if omitted and `baseUrl` empty; use `envFile` + `pmemPath`. `pmem` must be runnable with your PowerMem `.env`.
- **HTTP:** `baseUrl` required when `mode` is `http` (or omit `mode` and set `baseUrl` only — inferred as HTTP). No `/api/v1` suffix. Optional `apiKey` if the server uses auth.
- **Restart the OpenClaw gateway** (or Mac menubar app) after changing config.

---

## Step 4: Verify plugin and PowerMem connection

In a terminal:

```bash
# Check PowerMem (CLI: pmem subprocess; HTTP: server)
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

If search returns the line you added (or similar), the full flow (PowerMem → plugin → OpenClaw) is working.

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
| `mode`        | No       | Backend: `"cli"` (default) or `"http"`. If omitted, non-empty `baseUrl` implies `http`. |
| `baseUrl`     | Yes (http) | PowerMem API base URL when `mode` is `http`, e.g. `http://localhost:8000`, no `/api/v1` suffix. |
| `apiKey`      | No       | Set when PowerMem server has API key authentication enabled (http mode). |
| `envFile`     | No       | CLI: path to PowerMem `.env` (default when using plugin defaults: `~/.openclaw/powermem/powermem.env`). |
| `pmemPath`    | No       | CLI: path to `pmem` executable; default `pmem`. |
| `userId`      | No       | User isolation (multi-user); default `openclaw-user`. |
| `agentId`     | No       | Agent isolation (multi-agent); default `openclaw-agent`. |
| `autoCapture` | No       | Auto-store from conversations after agent ends; default `true`. |
| `autoRecall`  | No       | Auto-inject relevant memories before agent starts; default `true`. |
| `inferOnAdd`  | No       | Use PowerMem intelligent extraction when adding; default `true`. |

**Auto-capture:** When a conversation ends, user/assistant text is sent to PowerMem with `infer: true`. PowerMem extracts and stores memories. At most 3 chunks per session (each up to 6000 chars).

---

## Agent tools

Exposed to OpenClaw agents:

- **memory_recall** — Search long-term memories by query.
- **memory_store** — Save information (with optional infer).
- **memory_forget** — Delete by memory ID or by search query.

---

## OpenClaw CLI (when plugin enabled)

- `openclaw ltm search <query> [--limit n]` — Search memories.
- `openclaw ltm health` — Check PowerMem server health.
- `openclaw ltm add "<text>"` — Manually store one memory.

---

## Troubleshooting

**1. `openclaw ltm health` fails or cannot connect**

- **CLI:** `pmem` on PATH or correct `pmemPath`; valid `.env` at `envFile`.
- **HTTP:** PowerMem server running; `baseUrl` matches (e.g. `http://localhost:8000`; avoid mixing `127.0.0.1` vs `localhost` unless intentional).
- Remote server: use the host IP or hostname instead of `localhost`.

**2. Add/search returns nothing or 500**

- Check PowerMem terminal or Docker logs; often LLM/Embedding not configured or wrong API key.
- Ensure `LLM_API_KEY` and `EMBEDDING_API_KEY` in `.env` are set and valid.

**3. Plugin installed but OpenClaw not using memory**

- Confirm `plugins.slots.memory` is `memory-powermem` and `plugins.entries["memory-powermem"].enabled` is `true`.
- Restart the gateway (or OpenClaw app) after config changes.

**4. Agent does not search memory until I ask it to**

- With `autoRecall: true`, the plugin injects system guidance so the agent is told to use `memory_recall` (or injected `<relevant-memories>`) when answering about past events, preferences, or people. Ensure `autoRecall` is not set to `false`.
- Auto-recall runs before each turn using the current user message (or the last user message if the prompt is very short). If you still see the agent answering without checking memory, try being explicit once (e.g. "check your memory for …") and ensure the run uses the plugin (e.g. web UI after `/new` uses the same gateway and plugin).

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
