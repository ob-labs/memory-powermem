---
name: powermem-memory-quickstart
description: 最简单的 OpenClaw 长期记忆（PowerMem）安装步骤，面向个人用户；无需单独配置 powermem.env，复用 OpenClaw 里已配好的对话模型。
triggers:
  - "PowerMem 快速安装"
  - "PowerMem 最简单安装"
  - "怎么装 PowerMem 记忆"
  - "OpenClaw 记忆 怎么装"
  - "安装长期记忆"
  - "Quick install PowerMem"
  - "PowerMem quickstart"
  - "Easiest PowerMem setup"
---

# PowerMem 记忆 · 极简安装（个人用户）

你只要记住三件事：**OpenClaw 能正常聊天**、**本机装好 PowerMem**、**装上插件**。不用手写 `powermem.env`，记忆用的模型和 Key 会跟你在 OpenClaw 里配的一样。

---

## 你要做什么（按顺序）

1. **确认 OpenClaw 已经能用**  
   终端执行 `openclaw --version`，并且你已经在 OpenClaw 里配好了**平时对话用的模型**（能正常回复即可）。

2. **安装 PowerMem（Python）**  
   建议用虚拟环境，然后安装：
   ```bash
   python3 -m venv ~/.openclaw/powermem/.venv
   source ~/.openclaw/powermem/.venv/bin/activate
   pip install powermem
   ```
   装好后执行 `pmem --version`，能输出版本就行。

3. **让网关能找到 `pmem`**  
   如果你启动 `openclaw gateway` 的终端**没有**激活上面的 venv，有两种简单办法二选一：  
   - 每次开网关前先 `source ~/.openclaw/powermem/.venv/bin/activate`；或  
   - 在插件配置里把 **`pmemPath`** 写成 venv 里 `pmem` 的**完整路径**（装完后可用 `which pmem` 查看）。

4. **一键装插件（推荐）**  
   在 **Mac / Linux** 上执行（需已安装 OpenClaw）：
   ```bash
   curl -fsSL https://raw.githubusercontent.com/ob-labs/memory-powermem/main/install.sh | bash -s -y
   ```
   脚本会把插件放进 OpenClaw，并打开「用 OpenClaw 的模型驱动记忆」等默认选项。

5. **重启网关并检查**  
   ```bash
   openclaw gateway
   ```
   另开终端：
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
| `pip install powermem` 报错 | 确认 Python ≥ 3.10；换干净 venv 再试。 |
| `pmem` 找不到 | 激活 venv，或配置 **`pmemPath`** 为绝对路径。 |
| `ltm health` 不健康 | 确认 OpenClaw 里**默认模型**和 API Key 本身能聊天；升级 OpenClaw 到较新版本后再试。 |
| 想要更多选项（多实例、自建服务器等） | 看仓库里 **`skills/install-powermem-memory/SKILL.md`** 或根目录 **INSTALL.md**。 |

---

## 说明（一句话）

记忆数据默认存在本机 OpenClaw 数据目录下的 SQLite 里；**不需要**你再单独维护一份 PowerMem 的 `.env`，除非你熟悉进阶配置。
