---
name: install-memory-powermem
description: OpenClaw skill「快速安装」路径（skill id 与目录名均为 install-memory-powermem）：memory-powermem + PowerMem 最少步骤，面向个人用户；默认 powermem-ts（npm 包 powermem）CLI，无需 Python；无需单独配置 powermem.env，复用 OpenClaw 里已配好的对话模型。可独立分发；完整选项、工具说明与排错见 install-memory-powermem-full。
triggers:
  - "PowerMem 快速安装"
  - "PowerMem 最简单安装"
  - "memory-powermem 最小安装"
  - "怎么装 PowerMem 记忆"
  - "OpenClaw 记忆 怎么装"
  - "安装长期记忆"
  - "Quick install PowerMem"
  - "PowerMem quickstart"
  - "Easiest PowerMem setup"
  - "Minimal install memory-powermem"
  - "Install memory powermem minimal"
---

# PowerMem 记忆 · 快速安装（个人用户）

本 skill 在 OpenClaw 中的标识与建议目录名为 **`install-memory-powermem`**。若需要 HTTP/多实例、工具表与详细排错，请改用 **`install-memory-powermem-full`**（仓库内 `skills/install-memory-powermem-full/`，需一并拷贝该目录下全部 `.md`）。

你只要记住几件事：**OpenClaw 能正常聊天**、**装上 memory-powermem 插件**。默认走 **powermem-ts**（npm 包名 `powermem`，由插件依赖提供，**不需要**先装 Python）。不用手写 `powermem.env`，记忆用的模型和 Key 会跟你在 OpenClaw 里配的一样。

---

## 你要做什么（按顺序）

1. **确认 OpenClaw 已经能用**  
   终端执行 `openclaw --version`，并且你已经在 OpenClaw 里配好了**平时对话用的模型**（能正常回复即可）。

2. **安装 memory-powermem 插件**  
   任选其一：  
   - **registry：** `openclaw plugins install memory-powermem`  
   - **一键脚本（Mac / Linux）：**
     ```bash
     curl -fsSL https://raw.githubusercontent.com/ob-labs/memory-powermem/main/install.sh | bash -s -y
     ```
     已克隆本仓库时可在根目录执行 `bash install.sh`（可加 `-y`；多实例：`bash -s -- --workdir ~/.openclaw-second`）。  
   - **本地克隆：** `openclaw plugins install /path/to/memory-powermem` 或 **`openclaw plugins install -l`**（软链开发）  
   默认 **`pmemPath: bundled`**：使用插件依赖里的 **powermem-ts**（npm 包名 **`powermem`**）提供的 CLI，**不需要**本机 `pip install powermem`。

3. **若从本地路径安装：在插件目录安装 Node 依赖**  
   从 **npm registry** 安装或 **`install.sh`** 已在插件目录执行过依赖安装时，**可跳过本步**。否则进入 OpenClaw 指向的插件目录（或克隆根目录），执行 **`pnpm install` / `npm install`**，确保拉取 **`powermem`**、**`@langchain/openai`** 等。使用 **pnpm 10+** 时若 **`better-sqlite3`** 未编译，可执行 **`pnpm rebuild better-sqlite3`**（仓库 `package.json` 已配置 **`pnpm.onlyBuiltDependencies`** 时一般可自动构建）。

4. **（可选）改用 Python 版 `pmem`**  
   若你希望使用 [oceanbase/powermem](https://github.com/oceanbase/powermem) 的 **Python CLI**：**Python ≥ 3.10**，`pip install powermem`，并在插件配置里将 **`pmemPath`** 设为 venv 中 `pmem` 的**绝对路径**。详见 **`install-memory-powermem-full`** 与 **config-reference.md**。

5. **重启网关并检查**  
   ```bash
   openclaw gateway restart
   ```
   另开终端，**先**确认插件已被网关加载：
   ```bash
   openclaw plugins list
   ```
   输出里要有 **memory-powermem**，且其状态为 **loaded**（已加载）。若只有安装记录、状态不是 loaded，先按下面「若某一步失败」处理，**不要**跳过这步直接去测 `ltm`。  
   通过后再检查记忆健康并试写读：
   ```bash
   openclaw ltm health
   ```
   显示健康后试一句：
   ```bash
   openclaw ltm add "我喜欢喝美式"
   openclaw ltm search "咖啡"
   ```

---

## 若某一步失败

| 情况 | 怎么办 |
|------|--------|
| `pmem` / CLI 找不到、`ERR_MODULE_NOT_FOUND`（如 `@langchain/openai`） | 在插件目录执行 **`pnpm install` / `npm install`**；路径安装用 **`openclaw plugins install -l`** 时确保依赖完整。 |
| `better-sqlite3` 未编译（pnpm 忽略构建脚本） | 在插件目录 **`pnpm rebuild better-sqlite3`**，或配置 **`pnpm.onlyBuiltDependencies`** 后重装依赖（见仓库 `package.json`）。 |
| 坚持用 **Python** `pmem` 但找不到命令 | 激活 venv，或配置 **`pmemPath`** 为 `which pmem` 的绝对路径。 |
| `plugins list` 没有 **memory-powermem**，或状态不是 **loaded** | 确认已执行安装脚本或 `openclaw plugins install`；`plugins.enabled` 为 true、`plugins.slots.memory` 为 **memory-powermem**；改完后**重启 gateway**，再执行 `openclaw plugins list` 复查。 |
| `ltm health` 不健康 | 确认 OpenClaw 里**默认模型**和 API Key 本身能聊天；升级 OpenClaw 到较新版本后再试。 |
| 想要更多选项（多实例、HTTP、`install.sh` 细节、工具与排错表等） | 使用 **`install-memory-powermem-full`** skill（含 **config-reference.md**），或查阅 **[memory-powermem](https://github.com/ob-labs/memory-powermem)** 的 **README**。 |

---

## 说明（一句话）

记忆数据默认存在本机 OpenClaw 数据目录下的 SQLite 里；默认 CLI 为 **powermem-ts（npm）**；**不需要**你再单独维护一份 PowerMem 的 `.env`，除非你熟悉进阶配置。`userId/agentId` 未配置会自动生成并持久化。
