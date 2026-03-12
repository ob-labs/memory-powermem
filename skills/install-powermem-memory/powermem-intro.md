# PowerMem Introduction

Use this doc when the user asks "what is PowerMem", "why use PowerMem", or needs a product overview.

---

## What is PowerMem?

**PowerMem** ([GitHub: oceanbase/powermem](https://github.com/oceanbase/powermem)) is a **long-term memory service** that gives AI applications persistent, retrievable memory. It can run as an **HTTP server** (for clients like OpenClaw) or be used via the **CLI** (`pmem`) on the local machine.

- **OpenClaw does not bundle Python**: This plugin talks to PowerMem over HTTP API or by invoking `pmem`; the user must install and run PowerMem separately.
- **Data stays on the user's side**: Memories are stored in the user's own database (seekdb, oceanbase, etc.), as configured in PowerMem's `.env`.

---

## Core Features

| Feature | Description |
|---------|-------------|
| **Intelligent extraction (Infer)** | When writing memories, can use an LLM to summarize, dedupe, and structure content so only the essential information is stored. Requires LLM + Embedding configured in PowerMem. |
| **Ebbinghaus forgetting curve** | Supports adjusting memory weight or review policy by forgetting curve so important information lasts longer. |
| **Multi-agent / multi-user isolation** | Uses `userId`, `agentId`, etc. to separate memories per user or agent so they do not interfere. |
| **Vector search** | Semantic search over memories (embedding-based) to recall what is most relevant to the current conversation. |

---

## Relationship with OpenClaw

- **OpenClaw**: Provides gateway, sessions, tool dispatch, etc.; its **memory slot** must be implemented by a plugin.
- **openclaw-extension-powermem**: Implements the memory slot and forwards store/recall/forget requests to PowerMem (HTTP or CLI).
- **PowerMem**: Handles storage, retrieval, intelligent extraction, and forgetting curve; it is where data actually lives.

So: the user must **install and run PowerMem first** (or install the `pmem` CLI), then install this plugin and configure the connection (HTTP `baseUrl` or CLI `pmemPath`).

---

## Advantages over OpenClaw file-based memory

OpenClaw can work with **file-as-memory**: storing context in workspace files like `memory/YYYY-MM-DD-slug.md`, `MEMORY.md`, or `memory.md`, and using built-in search over those files. The **session-memory** hook writes a snapshot to a file on `/new` or `/reset`. PowerMem (via this plugin) offers a different model with these advantages:

| Aspect | File-based (OpenClaw default) | PowerMem + plugin |
|--------|--------------------------------|--------------------|
| **Recall** | Load fixed files (e.g. today + yesterday) or search workspace; relevance is by recency or keyword/embedding over raw text. | **Semantic recall**: only the top‑k most relevant memories are injected per turn, with score threshold and limit. Fewer tokens, more focused context. |
| **Storage** | Append or overwrite Markdown; no automatic deduplication or structure. | **Structured store** in a DB (seekdb/oceanbase) with **intelligent extraction**: LLM can summarize, dedupe, and normalize when adding, so you keep essential facts instead of raw dumps. |
| **Decay / importance** | Files accumulate unless you manually consolidate or prune. | **Ebbinghaus forgetting curve**: importance and retention can be tuned so older or less relevant memories fade appropriately. |
| **Isolation** | Usually one workspace = one user; multi-agent or multi-user requires separate workspaces or conventions. | **userId / agentId**: same PowerMem backend can serve multiple users or agents with isolated namespaces. |
| **Auto-capture / auto-recall** | Session-memory saves on `/new` or `/reset`; the agent must explicitly read and write memory files otherwise. | **Auto-capture** at end of conversation and **auto-recall** before each turn, so memory is updated and injected without extra user or agent steps. |

Use this section when the user asks why to use PowerMem instead of (or in addition to) OpenClaw’s file-based memory.

---

## Two Usage Modes

- **HTTP mode**: Run `powermem-server` on the host or a server; the OpenClaw plugin calls its API via `baseUrl`. Suited for multi-client, multi-user, or centralized deployment.
- **CLI mode**: No server; the plugin invokes the user's local `pmem` command. Suited for single-machine, lightweight use.

For full install and configuration steps, see **SKILL.md** in this folder.
