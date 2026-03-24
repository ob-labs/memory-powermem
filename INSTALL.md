# Install PowerMem Memory for OpenClaw

Give [OpenClaw](https://github.com/openclaw/openclaw) long-term memory via [PowerMem](https://github.com/oceanbase/powermem): intelligent extraction, Ebbinghaus forgetting curve. After setup, OpenClaw can **remember** facts from conversations and **recall** relevant context before responding.

---

## One-Click Install (Linux / macOS)

**Prerequisites:** OpenClaw installed (`openclaw --version`).

**Default path:** The script configures **CLI mode** (no `powermem-server`). With current plugin defaults you **do not need** `powermem.env`: the plugin injects **SQLite** under your OpenClaw state directory and **LLM/embedding** from OpenClaw `agents.defaults.model` + provider keys (same as the gateway). The script may still create `~/.openclaw/powermem/powermem.env` as an optional override template. You still need `pip install powermem` and `pmem` on PATH (or `pmemPath`).

```bash
curl -fsSL https://raw.githubusercontent.com/ob-labs/memory-powermem/main/install.sh | bash
```

Or run from the repo root (no download):

```bash
cd /path/to/memory-powermem
bash install.sh
```

Non-interactive (defaults: **CLI** mode, env file `~/.openclaw/powermem/powermem.env`, SQLite template if new):

```bash
curl -fsSL https://raw.githubusercontent.com/ob-labs/memory-powermem/main/install.sh | bash -s -y
```

Install to a specific OpenClaw instance:

```bash
curl -fsSL ... | bash -s -- --workdir ~/.openclaw-second
```

The script will: 1) resolve OpenClaw workdir, 2) ask mode (**cli** / http) and paths, 3) for CLI, seed `powermem.env` if absent, 4) deploy the plugin into `<workdir>/extensions/memory-powermem`, 5) run `npm install` there, 6) set OpenClaw config (plugins.enabled, slots.memory, entries.memory-powermem).

**After running (CLI):** Ensure `pmem` is on PATH (or set `pmemPath`), then `openclaw gateway` and `openclaw ltm health`. With plugin defaults you normally **do not** need to edit `powermem.env`—LLM keys come from OpenClaw. Optional template file may still be created under `~/.openclaw/powermem/`.

**After running (HTTP / enterprise):** Start PowerMem in a directory with `.env`, then `openclaw gateway`.

---

## Quick Start (Let OpenClaw Install It)

Copy **one** skill you want into OpenClaw’s skills directory, then ask OpenClaw to follow it. The two skills below are **independent** (each is complete for its scope; neither references the other).

### OpenClaw skill — minimal install (`install-powermem-memory-minimal`)

Short steps, no `powermem.env` required.

**Linux / macOS:**

```bash
mkdir -p ~/.openclaw/skills/install-powermem-memory-minimal
cp /path/to/memory-powermem/skills/install-powermem-memory-minimal/SKILL.md \
   ~/.openclaw/skills/install-powermem-memory-minimal/
```

Then say e.g. **「PowerMem 快速安装」** / **“PowerMem quickstart”** or **「memory-powermem 最小安装」** / **“Minimal install memory-powermem”** / **“Install powermem memory minimal”**.

### OpenClaw skill — full guide (`install-powermem-memory`)

Install, configuration options, tools, and troubleshooting (includes bundled reference docs in the skill folder).

**Linux / macOS:**

```bash
mkdir -p ~/.openclaw/skills/install-powermem-memory
cp /path/to/memory-powermem/skills/install-powermem-memory/SKILL.md \
   ~/.openclaw/skills/install-powermem-memory/
```

**Windows (PowerShell):**

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.openclaw\skills\install-powermem-memory"
Copy-Item "path\to\memory-powermem\skills\install-powermem-memory\SKILL.md" `
  "$env:USERPROFILE\.openclaw\skills\install-powermem-memory\"
```

Then say **「安装 PowerMem 记忆」** or **“Install PowerMem memory”**.

For manual installation, continue below.

---

## Prerequisites

| Component    | Purpose |
|-------------|---------|
| **OpenClaw** | CLI + gateway; run `openclaw --version` and `openclaw onboard` if needed. |
| **PowerMem** | **CLI (recommended):** `pip install powermem`, `pmem` on PATH, `.env` at `~/.openclaw/powermem/powermem.env` (install script can create a template). **HTTP:** run `powermem-server` and set plugin `mode: http` + `baseUrl`. |

You do **not** install PowerMem inside OpenClaw; the plugin runs `pmem` subprocesses (CLI) or calls a HTTP API (server).

---

## Manual Installation Steps

### 1. Install PowerMem (CLI first)

```bash
python3 -m venv ~/.openclaw/powermem/.venv
source ~/.openclaw/powermem/.venv/bin/activate
pip install powermem
```

Create or edit `~/.openclaw/powermem/powermem.env` (see [PowerMem .env.example](https://github.com/oceanbase/powermem/blob/master/.env.example)). Minimal fields: `DATABASE_PROVIDER=sqlite`, `SQLITE_PATH` (absolute path recommended), `LLM_*`, `EMBEDDING_*`.

Verify: `pmem --version` (with venv activated).

**(Optional) HTTP mode:** install PowerMem, put `.env` in a working directory, run `powermem-server --host 0.0.0.0 --port 8000`, verify `curl -s http://localhost:8000/api/v1/system/health`.

### 2. Install the plugin into OpenClaw

```bash
openclaw plugins install /path/to/memory-powermem
# Or symlink for development:
openclaw plugins install -l /path/to/memory-powermem
```

Confirm: `openclaw plugins list` shows `memory-powermem`.

### 3. Configure OpenClaw

Edit `~/.openclaw/openclaw.json` (or set via `openclaw config set`).

**CLI mode (default, no server):**

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

Use your real home path for `envFile`. If `pmem` is only inside a venv, set `pmemPath` to the absolute path of the `pmem` binary.

**HTTP mode (shared / enterprise):**

```json
"config": {
  "mode": "http",
  "baseUrl": "http://localhost:8000",
  "autoCapture": true,
  "autoRecall": true,
  "inferOnAdd": true
}
```

If you omit `mode` but set a non-empty `baseUrl`, the plugin treats the backend as **http** (backward compatible).

### 4. Restart and verify

Restart the OpenClaw gateway (or app), then:

```bash
openclaw ltm health
openclaw ltm add "I prefer Americano in the morning"
openclaw ltm search "coffee"
```

If health is OK and search returns the memory, setup is complete.

---

## Multi-Instance (--workdir)

To target a different OpenClaw instance:

```bash
# Install script
curl -fsSL ... | bash -s -- --workdir ~/.openclaw-second

# Manual config
OPENCLAW_STATE_DIR=~/.openclaw-second openclaw config set plugins.slots.memory memory-powermem
```

---

## Troubleshooting

| Symptom | Fix |
|--------|-----|
| `openclaw ltm health` fails | **CLI:** `pmem` not on PATH or wrong `pmemPath`; fix `.env` keys. **HTTP:** server down or wrong `baseUrl`. |
| Plugin not loaded | Ensure `plugins.slots.memory` is `memory-powermem` and gateway restarted. |
| Add/search returns 500 or empty | Check PowerMem logs; usually missing `LLM_*` / `EMBEDDING_*` in `.env`. |

More: [README.md#troubleshooting](README.md#troubleshooting).
