# OpenClaw Memory (PowerMem) Plugin

This plugin lets [OpenClaw](https://github.com/openclaw/openclaw) use long-term memory via the [PowerMem](https://github.com/oceanbase/powermem) HTTP API: intelligent extraction, Ebbinghaus forgetting curve, multi-agent isolation. **No Python inside OpenClaw**—only a separately running PowerMem server is required.

Follow the steps in order: install and start PowerMem, then install the plugin, configure OpenClaw, and verify.

---

## Prerequisites

- **OpenClaw** installed (CLI + gateway working)
- **PowerMem server**: install and run it separately (choose one of the two methods below)
- For PowerMem’s “intelligent extraction”: configure LLM + Embedding API keys in PowerMem’s `.env` (e.g. Qwen / OpenAI)

---

## Step 1: Install and start PowerMem

Choose **Option A (pip)** or **Option B (Docker)**.

### Option A: Install with pip (run server locally)

Best if you already have Python 3.10+.

**1. Install PowerMem**

```bash
pip install powermem
```

**2. Prepare config**

In **any directory** where you want to keep config (e.g. `~/powermem`):

```bash
mkdir -p ~/powermem && cd ~/powermem
# If you cloned PowerMem: cp /path/to/powermem/.env.example .env
# Otherwise use the minimal .env below.
```

If you did not clone the PowerMem repo, create a `.env` with at least: database + LLM + Embedding. Here is a **minimal working example** (SQLite + Qwen; replace with your API key):

```bash
# Create .env in ~/powermem (replace your_api_key_here)
cat > .env << 'EOF'
TIMEZONE=Asia/Shanghai
DATABASE_PROVIDER=sqlite
SQLITE_PATH=./data/powermem_dev.db
SQLITE_COLLECTION=memories

LLM_PROVIDER=qwen
LLM_API_KEY=your_api_key_here
LLM_MODEL=qwen-plus

EMBEDDING_PROVIDER=qwen
EMBEDDING_API_KEY=your_api_key_here
EMBEDDING_MODEL=text-embedding-v4
EMBEDDING_DIMS=1536
EOF
```

Replace `your_api_key_here` with your Qwen API key. For OpenAI or others, see PowerMem’s [.env.example](https://github.com/oceanbase/powermem/blob/master/.env.example) for `LLM_*` and `EMBEDDING_*`.

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

Database can stay default (SQLite).

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

## Step 2: Install the plugin into OpenClaw

On your machine (use your actual plugin path):

```bash
# Install from a local directory (e.g. cloned repo)
openclaw plugins install /path/to/openclaw-extension-powermem

# For development (symlink, no copy)
openclaw plugins install -l /path/to/openclaw-extension-powermem
```

After install, run `openclaw plugins list` and confirm `memory-powermem` is listed.

---

## Step 3: Configure OpenClaw to use the plugin

Edit OpenClaw’s config (e.g. `~/.openclaw/openclaw.json). Add or merge `plugins.slots.memory` and `plugins.entries["memory-powermem"]`, and set the PowerMem URL.

**Example (JSON):**

```json
{
  "plugins": {
    "slots": { "memory": "memory-powermem" },
    "entries": {
      "memory-powermem": {
        "enabled": true,
        "config": {
          "baseUrl": "http://localhost:8000",
          "autoCapture": true,
          "autoRecall": true,
          "inferOnAdd": true
        }
      }
    }
  }
}
```

**CLI mode (no server):** To use the PowerMem CLI instead of the HTTP server (same machine, no `powermem-server`), set `"mode": "cli"` and optionally `envFile` / `pmemPath`:

```json
"config": {
  "mode": "cli",
  "envFile": "/path/to/powermem/.env",
  "pmemPath": "pmem",
  "autoCapture": true,
  "autoRecall": true,
  "inferOnAdd": true
}
```

Notes:

- **HTTP (default):** `baseUrl` is required; PowerMem HTTP base URL **without** `/api/v1`, e.g. `http://localhost:8000`. If PowerMem has API key auth, add `"apiKey": "your-key"`.
- **CLI:** Set `mode` to `"cli"`. Optional: `envFile` (path to PowerMem `.env`), `pmemPath` (default `pmem`). Requires `pmem` on PATH and a valid PowerMem config (e.g. `.env`).
- **Restart the OpenClaw gateway** (or Mac menubar app) after changing config.

---

## Step 4: Verify plugin and PowerMem connection

In a terminal:

```bash
# Check PowerMem reachability
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

## Config options (optional)

| Option        | Required | Description |
|---------------|----------|-------------|
| `mode`        | No       | Backend: `"http"` (default) or `"cli"`. Use `cli` to run `pmem` locally without a server. |
| `baseUrl`     | Yes (http) | PowerMem API base URL when `mode` is `http`, e.g. `http://localhost:8000`, no `/api/v1` suffix. |
| `apiKey`      | No       | Set when PowerMem server has API key authentication enabled (http mode). |
| `envFile`     | No       | CLI mode: path to PowerMem `.env` file. Optional; pmem discovers if omitted. |
| `pmemPath`    | No       | CLI mode: path to `pmem` executable; default `pmem`. |
| `userId`      | No       | PowerMem `user_id` for isolation; default `openclaw-user`. |
| `agentId`     | No       | PowerMem `agent_id` for isolation; default `openclaw-agent`. |
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

- Ensure PowerMem is running (Option A terminal still open, or Docker container up).
- Ensure `baseUrl` matches the real address (use `http://localhost:8000` for local).
- If OpenClaw and PowerMem are on different machines, use PowerMem’s host IP or hostname instead of `localhost`.

**2. Add/search returns nothing or 500**

- Check PowerMem terminal or Docker logs; often LLM/Embedding not configured or wrong API key.
- Ensure `LLM_API_KEY` and `EMBEDDING_API_KEY` in `.env` are set and valid.

**3. Plugin installed but OpenClaw not using memory**

- Confirm `plugins.slots.memory` is `memory-powermem` and `plugins.entries["memory-powermem"].enabled` is `true`.
- Restart the gateway (or OpenClaw app) after config changes.

---

## Repository development

```bash
cd /path/to/openclaw-extension-powermem
pnpm install
pnpm lint   # type-check
pnpm test   # run tests (if any)
```

---

## License

Apache License 2.0. See [LICENSE](LICENSE).
