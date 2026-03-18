<p align="center">

*[PowerMem](https://github.com/oceanbase/powermem) + [OpenClaw](https://github.com/openclaw/openclaw)：为 AI Agent 极致的省 Token。*

<img src="docs/images/openclaw_powermem.jpeg" alt="PowerMem with OpenClaw" width="900"/>

</p>

# OpenClaw Memory (PowerMem) 插件

本插件让 [OpenClaw](https://github.com/openclaw/openclaw) 通过 [PowerMem](https://github.com/oceanbase/powermem) 使用长期记忆：智能抽取、艾宾浩斯遗忘曲线、多 Agent 隔离。

按顺序操作：先安装并启动 PowerMem，再安装插件、配置 OpenClaw，最后验证。

---

## 前置条件

- 已安装 **OpenClaw**（CLI + gateway 能正常用）
- **PowerMem 服务**：需要单独安装并启动（见下文两种方式，任选其一）
- 若用 PowerMem 的「智能抽取」：需在 PowerMem 的 `.env` 里配置好 LLM + Embedding 的 API Key（如通义千问 / OpenAI）

---

## 第一步：安装并启动 PowerMem

任选 **方式 A（pip）** 或 **方式 B（Docker）**，二选一即可。

### 方式 A：用 pip 安装（本机跑服务）

适合本机已有 Python 3.11+ 的情况。

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

### 方式 B：用 Docker 运行（不装 Python 也行）

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

- **一键安装（Linux/macOS）：** 见 [INSTALL.md](INSTALL.md)，使用 `install.sh`（curl 或从仓库根目录执行）。
- **交给 OpenClaw 安装：** 将 [skills/install-powermem-memory/SKILL.md](skills/install-powermem-memory/SKILL.md) 复制到 `~/.openclaw/skills/install-powermem-memory/`，然后对 OpenClaw 说「**安装 PowerMem 记忆**」。
- **手动安装：** 按下面步骤操作。

---

## 第二步：把本插件装进 OpenClaw

在**你本机**执行（路径改成你实际克隆的目录）：

```bash
# 从 npm 安装（推荐给终端用户；会从 npm 官方源自动下载并安装）
openclaw plugins install openclaw-extension-powermem

# 若插件在本机目录（例如克隆下来的）
openclaw plugins install /path/to/openclaw-extension-powermem

# 开发时想改代码即生效，可用链接方式（不拷贝）
openclaw plugins install -l /path/to/openclaw-extension-powermem
```

**说明：** 在某个 Node 项目里执行 `npm i openclaw-extension-powermem` 只会把包装进该项目的 `node_modules`，**不会**在 OpenClaw 里注册插件。若要在 OpenClaw 里使用本插件，必须执行 `openclaw plugins install openclaw-extension-powermem`（或按上面用本地路径安装），再重启 gateway。

安装成功后，可用 `openclaw plugins list` 确认能看到 `memory-powermem`。未在配置中书写本插件 config 时，插件会使用 **默认配置**：`baseUrl: "http://localhost:8000"`，并开启 `autoCapture`、`autoRecall`、`inferOnAdd`，因此典型情况（PowerMem 跑在 localhost:8000）下无需编辑 `~/.openclaw/openclaw.json`。

---

## 第三步：配置 OpenClaw（可选）

若 PowerMem 在 **http://localhost:8000** 且使用默认选项，可跳过本步。若要 **自定义**（如改 URL、API Key 或使用 CLI 模式），请编辑 OpenClaw 配置文件（如 `~/.openclaw/openclaw.json`），增加或合并 `plugins` 段。

**示例（JSON）：**

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

**CLI 模式（无需起服务）：** 若希望用 PowerMem CLI 而不是 HTTP 服务（本机、不跑 powermem-server），可设置 `"mode": "cli"`，并可选填 `envFile` / `pmemPath`：

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

说明：

- **HTTP（默认）：** 需填写 `baseUrl`，PowerMem 的 HTTP 地址，**不要**加 `/api/v1`。若 PowerMem 开了 API Key 鉴权，在 `config` 里增加 `"apiKey": "你的key"`。
- **CLI：** 将 `mode` 设为 `"cli"`。可选：`envFile`（PowerMem 的 `.env` 路径）、`pmemPath`（默认 `pmem`）。需本机已安装 `pmem` 且配置好 PowerMem（如 `.env`）。
- 改完配置后**重启 OpenClaw gateway**（或重启 Mac 菜单栏应用），配置才会生效。

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

## 配置项说明（可选）

| 选项          | 必填 | 说明 |
|---------------|------|------|
| `mode`        | 否   | 后端：`"http"`（默认）或 `"cli"`。选 `cli` 时本机直接跑 `pmem`，无需起服务。 |
| `baseUrl`     | 是（http） | `mode` 为 `http` 时必填，PowerMem API 根地址，如 `http://localhost:8000`，不要带 `/api/v1`。 |
| `apiKey`      | 否   | PowerMem 开启 API Key 鉴权时填写（http 模式）。 |
| `envFile`     | 否   | CLI 模式：PowerMem `.env` 文件路径；不填则 pmem 自动发现。 |
| `pmemPath`    | 否   | CLI 模式：`pmem` 可执行路径，默认 `pmem`。 |
| `userId`      | 否   | 用于多用户隔离，默认 `openclaw-user`。 |
| `agentId`     | 否   | 用于多 Agent 隔离，默认 `openclaw-agent`。 |
| `autoCapture` | 否   | 会话结束后是否自动把对话交给 PowerMem 抽取记忆，默认 `true`。 |
| `autoRecall`  | 否   | 会话开始前是否自动注入相关记忆，默认 `true`。 |
| `inferOnAdd`  | 否   | 写入时是否用 PowerMem 智能抽取，默认 `true`。 |

**自动抓取**：会话结束时，会把本轮用户/助手文本发给 PowerMem（`infer: true`），由 PowerMem 抽取并落库。每轮最多 3 条，每条约 6000 字符以内。

---

## Agent 内工具

在 OpenClaw Agent 里会暴露这些能力：

- **memory_recall** — 按查询搜索长期记忆
- **memory_store** — 写入一条记忆（可选是否智能抽取）
- **memory_forget** — 按记忆 ID 或按搜索条件删除

---

## OpenClaw CLI 命令（插件启用后）

- `openclaw ltm search <query> [--limit n]` — 搜索记忆
- `openclaw ltm health` — 检查 PowerMem 服务健康
- `openclaw ltm add "<text>"` — 手动写入一条记忆

---

## 常见问题

**1. `openclaw ltm health` 报错连不上**

- 确认 PowerMem 已启动（方式 A 的终端还在跑，或 Docker 容器在运行）。
- 确认 `baseUrl` 与真实地址一致（本机用 `http://localhost:8000`，别写 `127.0.0.1` 除非你确定一致）。
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
cd /path/to/openclaw-extension-powermem
pnpm install
pnpm lint   # 类型检查
pnpm test   # 运行测试（若有）
```

---

## 许可证

Apache License 2.0，见 [LICENSE](LICENSE)。
