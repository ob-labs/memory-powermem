# Config & Commands Quick Reference

Quick reference for this skill folder. See **SKILL.md** for full details.

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
| `mode` | `http` | `http` (PowerMem server) or `cli` (local pmem) |
| `baseUrl` | — | Required when mode is http, e.g. `http://localhost:8000` |
| `apiKey` | — | Optional; set when PowerMem server has auth enabled |
| `envFile` | — | CLI mode: path to PowerMem `.env` |
| `pmemPath` | `pmem` | CLI mode: path to `pmem` executable |
| `recallLimit` | `5` | Max number of memories per recall |
| `recallScoreThreshold` | `0` | Min score (0–1) to include a memory |
| `autoCapture` | `true` | Auto-store from conversations |
| `autoRecall` | `true` | Auto-inject relevant memories before replying |
| `inferOnAdd` | `true` | Use PowerMem intelligent extraction when adding |

---

## Common OpenClaw commands

```bash
# Health check
openclaw ltm health

# Manual add / search
openclaw ltm add "Something to remember"
openclaw ltm search "query"

# Disable memory slot
openclaw config set plugins.slots.memory none

# Re-enable
openclaw config set plugins.slots.memory memory-powermem
```

Restart the gateway after changing plugin or memory-slot config for changes to take effect.
