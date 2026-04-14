# PowerMem Introduction

Ships with OpenClaw skill **`install-memory-powermem-full`** (folder `install-memory-powermem-full`). Use this doc when the user asks "what is PowerMem", "why use PowerMem", or needs a product overview.

---

## What is PowerMem?

**PowerMem** is a **long-term memory engine** with multiple implementations. The **memory-powermem** plugin’s **default** is **powermem-ts** ([ob-labs/powermem-ts](https://github.com/ob-labs/powermem-ts) on npm as package **`powermem`**): the plugin runs the **`pmem` CLI** from **`node_modules`** (**`pmemPath: bundled`**) on the same machine as OpenClaw. Alternatively you can point **`pmemPath`** at the **Python** CLI from [oceanbase/powermem](https://github.com/oceanbase/powermem), or run an **HTTP server** (**`powermem-server`**) for shared or team setups.

- **No Python required for the default path**: The bundled npm CLI is sufficient. Python / Docker remain optional for operators who prefer the upstream Python stack or containerized server.
- **Data stays on the user’s machine** (typical setup): **SQLite** under the OpenClaw **state directory** (`<stateDir>/powermem/data/powermem.db`) when using plugin defaults—**no `powermem.env` file is required** for that layout. Larger deployments can still use OceanBase, PostgreSQL, etc., configured in PowerMem’s own `.env` or server config.

---

## Core Features

| Feature | Description |
|---------|-------------|
| **Intelligent extraction (Infer)** | On write, an LLM can summarize, dedupe, and structure content. Needs LLM + embedding configured—either injected from **OpenClaw** (default) or from a PowerMem `.env`. |
| **Ebbinghaus forgetting curve** | Adjusts retention / importance so less relevant memories fade over time. |
| **Multi-agent / multi-user isolation** | `userId`, `agentId`, etc. separate namespaces in the store. |
| **Vector search** | Embedding-based semantic search for recall. |

---

## Relationship with OpenClaw

- **OpenClaw**: Gateway, sessions, tools; the **memory slot** is filled by a plugin.
- **memory-powermem**: Implements that slot and forwards add/search/forget to PowerMem (CLI or HTTP).
- **PowerMem**: Stores data, runs extraction, search, and forgetting logic.

**Typical personal setup:** Install **memory-powermem** (plugin runs **powermem-ts** via **`bundled`**), ensure **`agents.defaults.model`** and provider keys are set in OpenClaw, use **CLI mode** with defaults (`useOpenClawModel: true`, no `envFile`). The plugin supplies SQLite paths and LLM/embedding env to each `pmem` call. *Optional:* `pip install powermem` (Python) and set **`pmemPath`** to that binary if you do not use the bundled CLI.

**Optional:** Point **`envFile`** at a PowerMem `.env` for advanced DB/provider tuning; OpenClaw can still override LLM-related keys when `useOpenClawModel` is true.

**HTTP mode:** Run `powermem-server`, set plugin `mode: http` and `baseUrl`.

---

## Advantages over OpenClaw file-based memory

OpenClaw can use **files as memory** (e.g. `memory/YYYY-MM-DD.md`, `MEMORY.md`). The **session-memory** hook snapshots to disk on `/new` or `/reset`. PowerMem + this plugin differ as follows:

| Aspect | File-based (typical) | PowerMem + plugin |
|--------|----------------------|-------------------|
| **Recall** | Fixed files or workspace search; relevance often by recency or simple search. | **Semantic recall**: top‑k memories per turn with score threshold and limits; fewer tokens. |
| **Storage** | Append/overwrite Markdown; manual cleanup. | **DB-backed** store (default **SQLite** locally) with optional **intelligent extraction**. |
| **Decay / importance** | Manual consolidation. | **Ebbinghaus-style** tuning where supported. |
| **Isolation** | Often one workspace per context. | **`userId` / `agentId`** namespaces on one backend. |
| **Auto flow** | Agent must read/write files unless hooks cover it. | **Auto-capture** after conversations and **auto-recall** before turns (plugin hooks). |

---

## Two usage modes

- **CLI mode (default)**: Plugin runs **`pmem`** (default: npm **powermem-ts**); SQLite + LLM often come from **OpenClaw config** (no mandatory `.env`).
- **HTTP mode**: Central `powermem-server`; plugin uses `baseUrl` (and optional `apiKey`).

Full steps: **SKILL.md** in this folder.
