# Config & Commands Quick Reference

Quick reference for this skill folder. See **SKILL.md** for the full install flow.

---

## Before the plugin: PowerMem (Python)

- **Python 3.10+** — `python3 --version`.
- **Install** — `pip install powermem` (virtualenv recommended).
- **CLI (default)** — No `powermem.env` required for a minimal setup: the plugin injects **SQLite** (under the OpenClaw **state directory**) and **LLM + embedding** from OpenClaw (`agents.defaults.model` + provider keys), as long as `useOpenClawModel` is `true` (default).
- **`pmem` on PATH** — When you start `openclaw gateway`, the same environment should expose `pmem`, or set plugin `pmemPath` to the binary’s absolute path (e.g. inside a venv).
- **Optional `.env`** — Set `envFile` to a PowerMem `.env` if you want file-based overrides; if the file exists, it is loaded first, then OpenClaw-derived variables **override** the same keys (when `useOpenClawModel` is true).
- **HTTP (shared server)** — Run `powermem-server` with its own `.env`; plugin `mode: http` + `baseUrl`. Verify with `curl` on `/api/v1/system/health`.

---

## OpenClaw requirements (CLI + auto LLM)

- Configure **`agents.defaults.model`** (e.g. `openai/gpt-4o-mini`) and provider credentials in **`models.providers`** (and/or auth the way you normally do for the gateway).
- Gateway should expose plugin **`api.config`** and **`api.runtime.modelAuth`** (recent OpenClaw releases, e.g. 2026.3.x). If those are missing, rely on a full **`envFile`** or set **`useOpenClawModel: false`** and supply `LLM_*` / `EMBEDDING_*` yourself.

---

## SQLite data location (CLI, default)

- **`<stateDir>/powermem/data/powermem.db`**, where `stateDir` is from OpenClaw (`resolveStateDir`), typically `~/.openclaw` unless `OPENCLAW_STATE_DIR` / `--workdir` points elsewhere.

---

## Installing PowerMem (do this before the plugin)

- **Python 3.10+** required. Check with `python3 --version`.
- **Install**: `pip install powermem` (prefer inside a virtualenv).
- **HTTP mode**: Create a `.env` (copy from [PowerMem .env.example](https://github.com/oceanbase/powermem/blob/master/.env.example)), set at least database + LLM + Embedding. Start server in that directory: `powermem-server --port 8000`. Verify: `curl -s http://localhost:8000/api/v1/system/health`.
- **CLI mode**: Ensure `pmem` is on PATH (e.g. activate the venv where powermem is installed). Optional: `pmem config init` for `.env`.

---

## Plugin configuration

| Key | Default | Description |
|-----|---------|-------------|
| `mode` | `cli` | `cli` (local `pmem`) or `http` (`powermem-server`). |
| `baseUrl` | — | Required when `mode` is `http` (or omit `mode` and set non-empty `baseUrl` → HTTP). |
| `apiKey` | — | HTTP: optional PowerMem server API key. |
| `envFile` | — | CLI: optional path to PowerMem `.env` (only used if the file exists). |
| `pmemPath` | `pmem` | CLI: `pmem` executable path. |
| `useOpenClawModel` | `true` | Inject LLM/embedding from OpenClaw; default SQLite under state dir. Set `false` to disable injection (you must then provide a full `.env` or env vars). |
| `recallLimit` | `5` | Max memories per recall / auto-recall. |
| `recallScoreThreshold` | `0` | Min score (0–1) to keep a hit. |
| `autoCapture` | `true` | Auto-store from conversations. |
| `autoRecall` | `true` | Auto-inject relevant memories before reply. |
| `inferOnAdd` | `true` | PowerMem intelligent extraction on add. |

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
