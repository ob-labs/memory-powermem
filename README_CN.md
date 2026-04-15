<p align="center">

*[PowerMem](https://github.com/oceanbase/powermem) + [OpenClaw](https://github.com/openclaw/openclaw)：为 AI Agent 极致的省 Token。*

<img src="docs/images/openclaw_powermem.jpeg" alt="PowerMem with OpenClaw" width="900"/>

</p>

# OpenClaw Memory (PowerMem) 插件

本插件让 [OpenClaw](https://github.com/openclaw/openclaw) 通过 [PowerMem](https://github.com/oceanbase/powermem) 使用长期记忆：智能抽取、艾宾浩斯遗忘曲线、多 Agent 隔离。支持 HTTP v2（按请求配置 + 代理共享）、LLM 经验提炼与本地 SQLite 双写。

**默认：CLI 模式** — 插件在本机执行 `pmem`，无需 `powermem-server`。**HTTP 模式** 适合已有共享 PowerMem API 的场景（团队 / 企业）。

按顺序操作：先安装 PowerMem，再安装插件、配置 OpenClaw（CLI + `~/.openclaw/powermem/powermem.env` 可零额外配置），最后验证。

---

## 前置条件

- 已安装 **OpenClaw**（CLI + gateway 能正常用）
- 已 `pip install powermem`，启动 gateway 时 `pmem` 在 PATH 上，或在插件里配置绝对路径 `pmemPath`
- PowerMem 的 **`.env`**（至少数据库 + LLM + Embedding），个人用户建议放在 `~/.openclaw/powermem/powermem.env`，数据库可用 SQLite

---

## 第一步：安装并启动 PowerMem

可选 **方式 A（CLI，推荐给 OpenClaw 个人用户）**、**方式 B（HTTP + pip）** 或 **方式 C（Docker）**。

### 方式 C：CLI + SQLite（推荐给个人）

不跑 HTTP 服务，与插件**默认**配置一致（`mode: cli`）。

1. 安装（建议 venv）：

   ```bash
   python3 -m venv ~/.openclaw/powermem/.venv
   source ~/.openclaw/powermem/.venv/bin/activate
   pip install powermem
   ```

2. 配置：克隆本仓库后在根目录执行 `bash install.sh`（或使用下方「安装方式」里的 curl 一键命令）可生成可选的 `~/.openclaw/powermem/powermem.env` 模板；也可复制 PowerMem 官方 `.env.example` 并填写 `LLM_*`、`EMBEDDING_*`（不依赖 OpenClaw 注入模型时需要）。

3. 若 `pmem` 只在 venv 里，在插件 `config` 里把 `pmemPath` 设为该 venv 下 `pmem` 的绝对路径。

4. 验证：激活 venv 后 `pmem --version`；启动 gateway 后 `openclaw ltm health`。

---

### 方式 B：用 pip 安装（本机跑 HTTP 服务）

适合要**单独起 API 服务**、或不使用 CLI 模式的场景。适合本机已有 Python 3.11+ 的情况。

**1. 安装 PowerMem**

```bash
pip install powermem
```

**2. 准备配置文件**

在**任意一个你打算放配置的目录**下执行（例如 `~/powermem`）：

```bash
mkdir -p ~/powermem && cd ~/powermem
# 从 PowerMem 官方仓库复制模板
# 若已克隆：cp /path/to/powermem/.env.example .env
```

若没有克隆 PowerMem 仓库，可以直接新建 `.env`，**最少**需要配置这三类（数据库 + LLM + Embedding）。下面是一个**最小可运行示例**seekdb/oceanbase + 通义千问，请换成你自己的 API Key）：

```bash
# 在 ~/powermem 目录下创建 .env，内容示例（请替换 your_api_key_here）
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

把上面的 `your_api_key_here` 换成你的通义千问 API Key。若用 OpenAI 等，请参考 PowerMem 官方 [.env.example](https://github.com/oceanbase/powermem/blob/master/.env.example) 修改 `LLM_*` 和 `EMBEDDING_*`。

**3. 启动 HTTP 服务**

**务必在放有 `.env` 的那个目录下**执行：

```bash
cd ~/powermem   # 或你放 .env 的目录
powermem-server --host 0.0.0.0 --port 8000
```

看到类似 `Uvicorn running on http://0.0.0.0:8000` 即表示成功。保持该终端不关。

**4. 验证 PowerMem 是否正常**

新开一个终端执行：

```bash
curl -s http://localhost:8000/api/v1/system/health
```

若返回 JSON（例如包含 `"status":"healthy"` 或类似字段），说明 PowerMem 已就绪。

---

### 方式 C：用 Docker 运行（不装 Python 也行）

适合本机有 Docker、不想装 Python 的情况。

**1. 克隆 PowerMem 仓库并准备 .env**

```bash
git clone https://github.com/oceanbase/powermem.git
cd powermem
cp .env.example .env
```

用编辑器打开 `.env`，**至少**填好：

- `LLM_API_KEY`、`LLM_PROVIDER`、`LLM_MODEL`
- `EMBEDDING_API_KEY`、`EMBEDDING_PROVIDER`、`EMBEDDING_MODEL`

数据库推荐使用（oceanbase）。

**2. 启动容器**

在 **powermem 项目根目录**（和 `.env` 同级）执行：

```bash
docker-compose -f docker/docker-compose.yml up -d
```

**3. 验证**

```bash
curl -s http://localhost:8000/api/v1/system/health
```

有 JSON 返回即表示服务正常。API 文档可浏览器打开：`http://localhost:8000/docs`。

---

## 安装方式

- **一键安装（Linux/macOS）：**  
  ```bash
  curl -fsSL https://raw.githubusercontent.com/ob-labs/memory-powermem/main/install.sh | bash
  ```  
  已克隆仓库：`cd /path/to/memory-powermem && bash install.sh`。非交互：同一 curl 命令改为接到 `bash -s -y`。指定另一数据目录：`bash -s -- --workdir ~/.openclaw-second`。更完整的说明与排错见 OpenClaw skill **`install-memory-powermem-full`**（[skills/install-memory-powermem-full/](skills/install-memory-powermem-full/)）。
- **OpenClaw skill — 快速安装（`install-memory-powermem`）：** 将 [skills/install-memory-powermem/SKILL.md](skills/install-memory-powermem/SKILL.md) 复制到 `~/.openclaw/skills/install-memory-powermem/`，然后说「**PowerMem 快速安装**」或「**memory-powermem 最小安装**」或 **“Install memory powermem minimal”**。  
- **OpenClaw skill — 完整指南（`install-memory-powermem-full`）：** 将 [skills/install-memory-powermem-full/SKILL.md](skills/install-memory-powermem-full/SKILL.md)（若从仓库拷贝，建议连同该目录下其余 `.md` 一并放入 skill 目录）复制到 `~/.openclaw/skills/install-memory-powermem-full/`，然后说「**安装 PowerMem 记忆**」。快速安装与完整指南两个 skill **彼此独立**，按需选用其一即可。
- **手动安装：** 按下面步骤操作。

---

## 第二步：把本插件装进 OpenClaw

在**你本机**执行（路径改成你实际克隆的目录）：

```bash
# 从 npm 安装（推荐给终端用户；会从 npm 官方源自动下载并安装）
openclaw plugins install memory-powermem

# 若插件在本机目录（例如克隆下来的）
openclaw plugins install /path/to/memory-powermem

# 开发时想改代码即生效，可用链接方式（不拷贝）
openclaw plugins install -l /path/to/memory-powermem
```

**说明：** 在某个 Node 项目里执行 `npm i memory-powermem` 只会把包装进该项目的 `node_modules`，**不会**在 OpenClaw 里注册插件。若要在 OpenClaw 里使用本插件，必须执行 `openclaw plugins install memory-powermem`（或按上面用本地路径安装），再重启 gateway。

安装成功后，可用 `openclaw plugins list` 确认能看到 `memory-powermem`。若未写 `plugins.entries["memory-powermem"].config`，插件 **默认**：`mode: "cli"`、`pmemPath: "bundled"`（优先插件旁的 npm `powermem`，否则用 PATH 上的 `pmem`）、`useOpenClawModel: true`（SQLite 在 OpenClaw 状态目录 + 从 `agents.defaults.model` 注入 LLM），并开启 `autoCapture`、`autoRecall`、`inferOnAdd`。若不使用 OpenClaw 注入模型，再准备 `powermem` 的 `.env`（`envFile`）。

---

## 第三步：配置 OpenClaw（可选）

若使用 **CLI 默认**（`bundled` + OpenClaw 模型注入），可跳过。需要 HTTP、改 URL/API Key、使用 Python 版 `pmem`（`pmemPath: "auto"` 或绝对路径）、或通过 `envFile` 时再改配置。

**CLI（默认）：**

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

**HTTP（共享服务）：**

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

说明：

- **CLI（默认）：** 可不写 `mode` 且 `baseUrl` 为空时走 CLI。默认 `pmemPath` 为 `bundled`（npm CLI）。需要时再配 `envFile` / `pmemPath`。
- **HTTP：** `mode` 为 `http` 时必须配置 `baseUrl`；若只写 `baseUrl` 不写 `mode`，插件会按 HTTP 处理。**不要**在 `baseUrl` 上加 `/api/v1`。若服务开了 API Key，加 `"apiKey"`。
- 改完配置后**重启 OpenClaw gateway**（或 Mac 菜单栏应用）。

---

## 第四步：验证插件与 PowerMem 连通

在终端执行：

```bash
# 检查 PowerMem 服务是否可达
openclaw ltm health
```

若输出里没有报错、能看到健康状态，说明插件已连上 PowerMem。

再试一条手动写入 + 搜索：

```bash
# 写入一条记忆
openclaw ltm add "我的偏好是每天早上喝一杯美式咖啡"

# 按内容搜索
openclaw ltm search "咖啡"
```

若搜索能返回刚写的那条（或类似内容），说明「安装 PowerMem → 安装插件 → 配置 OpenClaw」全流程已打通。

---

## OpenClaw 插件常用命令（参考）

管理插件时常用的 CLI 命令：

| 命令 | 说明 |
|------|------|
| `openclaw plugins list` | 列出已安装插件，确认是否包含 `memory-powermem`。加 `--json` 可输出机器可读格式。 |
| `openclaw plugins info <id>` | 查看某个插件的详情（例如 `openclaw plugins info memory-powermem`）。 |
| `openclaw plugins uninstall <id>` | 卸载插件（例如 `openclaw plugins uninstall memory-powermem`）。加 `--keep-files` 可保留磁盘上的文件。 |
| `openclaw plugins enable <id>` | 启用已安装但被禁用的插件。 |
| `openclaw plugins disable <id>` | 禁用插件（不卸载）。 |
| `openclaw plugins doctor` | 诊断插件加载与配置问题。 |
| `openclaw plugins update <id>` | 更新从 npm 安装的插件。使用 `openclaw plugins update --all` 可更新全部。 |

安装、卸载或修改配置后，需重启 OpenClaw gateway 后才会生效。

---

## 配置项说明（可选）

| 选项          | 必填 | 说明 |
|---------------|------|------|
| `mode` | 否 | 后端：`"cli"`（默认）或 `"http"`。不写 `mode` 但填了 `baseUrl` 时按 HTTP 处理。 |
| `baseUrl` | 是（http） | `mode` 为 `http` 时必填，PowerMem API 根地址，如 `http://localhost:8000`，不要带 `/api/v1`。 |
| `apiKey` | 否 | PowerMem 开启 API Key 鉴权时填写（http 模式）。 |
| `httpApiVersion` | 否 | HTTP 版本：`"v1"`（默认）或 `"v2"`。 |
| `requestConfig` | 否 | HTTP v2 专用：按请求透传 `config`（如 `memory_db`）。 |
| `envFile` | 否 | CLI：PowerMem `.env`；插件默认约定 `~/.openclaw/powermem/powermem.env`。 |
| `pmemPath` | 否 | CLI：`bundled`（默认）、`auto` 或 `pmem` 的路径/命令。 |
| `userId` | 否 | 用于多用户隔离。未填或为 `"auto"` 时自动生成并保存到 `<stateDir>/powermem/identity.json`。 |
| `agentId` | 否 | 用于多 Agent 隔离。未填或为 `"auto"` 时自动生成并保存到 `<stateDir>/powermem/identity.json`。 |
| `autoCapture` | 否 | 会话结束后是否自动把对话交给 PowerMem 抽取记忆，默认 `true`。 |
| `autoRecall` | 否 | 会话开始前是否自动注入相关记忆，默认 `true`。 |
| `autoExperience` | 否 | LLM 自动提炼经验，默认 `true`。 |
| `experienceRecall` | 否 | 召回结果是否包含经验，默认 `true`。 |
| `inferOnAdd` | 否 | 写入时是否用 PowerMem 智能抽取，默认 `true`。 |
| `dualWrite` | 否 | 仅 HTTP：远端 + 本地 SQLite 双写，远端失败自动排队补传。 |
| `localDbPath` | 否 | 本地 SQLite 路径（`dualWrite`）。 |
| `localUserId` | 否 | 本地命名空间（`dualWrite`，默认 `userId`）。 |
| `localAgentId` | 否 | 本地命名空间（`dualWrite`，默认 `agentId`）。 |
| `syncOnResume` | 否 | 是否启动时补传，默认 `true`。 |
| `syncBatchSize` | 否 | 每批补传数量，默认 `50`。 |
| `syncMinIntervalMs` | 否 | 补传最小间隔，默认 `5000`。 |
| `syncBaseDelayMs` | 否 | 重试基础延迟，默认 `5000`。 |
| `syncMaxDelayMs` | 否 | 重试最大延迟，默认 `60000`。 |
| `syncMaxRetries` | 否 | 单条最大重试次数，默认 `10`。 |

**记忆划分与分享：** 建议用 `userId` / `agentId` 做逻辑隔离；HTTP v2 可用 `agent_memory_share` 进行显式共享。

**自动抓取**：会话结束时，会把本轮用户/助手文本发给 PowerMem（`infer: true`），由 PowerMem 抽取并落库。每轮最多 3 条，每条约 6000 字符以内。

---

## Agent 内工具

在 OpenClaw Agent 里会暴露这些能力：

- **memory_recall** — 按查询搜索长期记忆
- **memory_store** — 写入一条记忆（可选是否智能抽取）
- **memory_forget** — 按记忆 ID 或按搜索条件删除
- **experience_store** — 写入经验
- **experience_recall** — 查询经验
- **agent_memory_add** — 给其它 Agent 增加记忆（HTTP v2）
- **agent_memory_list** — 列出 Agent 记忆（HTTP v2）
- **agent_memory_share** — 共享 Agent 记忆（HTTP v2）
- **agent_memory_shared** — 列出共享记忆（HTTP v2）

---

## OpenClaw CLI 命令（插件启用后）

- `openclaw ltm search <query> [--limit n]` — 搜索记忆
- `openclaw ltm health` — 检查 PowerMem 服务健康
- `openclaw ltm add "<text>"` — 手动写入一条记忆

---

## 常见问题

**1. `openclaw ltm health` 报错连不上**

- **CLI：** 插件已安装 npm `powermem`（`bundled`），或 `pmemPath` 正确；未用 OpenClaw 注入时再保证 `envFile`。
- **HTTP：** PowerMem 已启动（方式 A 终端或 Docker）；`baseUrl` 正确（本机常用 `http://localhost:8000`，注意与 `127.0.0.1` 一致性问题）。
- 若 OpenClaw 和 PowerMem 不在同一台机器，把 `localhost` 改成 PowerMem 所在机器的 IP 或域名。

**2. 写入/搜索没反应或报 500**

- 看 PowerMem 终端或 Docker 日志，多半是 LLM/Embedding 未配置或 API Key 错误。
- 确保 `.env` 里 `LLM_API_KEY`、`EMBEDDING_API_KEY` 已填且有效。

**3. 插件已安装但 OpenClaw 没用上记忆**

- 确认配置里 `plugins.slots.memory` 为 `memory-powermem`，且 `plugins.entries["memory-powermem"].enabled` 为 `true`。
- 改完配置后必须重启 gateway（或 OpenClaw 应用）。

**4. 不主动说「从 PowerMem 查」Agent 就不查记忆**

- 开启 `autoRecall: true` 后，插件会注入系统级指引，告诉 Agent 在回答与过去、偏好、人物相关的问题时先使用 `memory_recall` 或本轮已注入的 `<relevant-memories>`。请确认未把 `autoRecall` 设为 `false`。
- 自动回忆在每轮开始前用当前用户消息（若 prompt 过短则用上一条用户消息）做检索。若仍出现不查就回复的情况，可先显式说一句「查一下记忆里关于……」确认流程正常；并确认 /new 后的 Web 会话走的是同一 gateway 与插件。

**5. Agent 尝试读取 `memory/YYYY-MM-DD.md` 并报 ENOENT**

- OpenClaw 自带的 **session-memory** hook 会把会话摘要写到工作区的 `memory/YYYY-MM-DD-slug.md`。使用 PowerMem 作为记忆槽时，Agent 仍可能被工作区文档或模型推断引导去读这些文件，导致 `read` 报错。建议禁用该 hook，只使用 PowerMem：执行 `openclaw hooks disable session-memory`，或在 `~/.openclaw/openclaw.json` 里将 `hooks.internal.entries["session-memory"].enabled` 设为 `false`。修改配置后需重启 gateway。

---

## 本仓库开发命令

```bash
cd /path/to/memory-powermem
pnpm install
pnpm lint   # 类型检查
pnpm test   # 运行测试（若有）
```

---

## 许可证

Apache License 2.0，见 [LICENSE](LICENSE)。
