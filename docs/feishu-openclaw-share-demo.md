# 飞书演示：两台 OpenClaw × 同一 PowerMem（记忆分享）

本文说明如何在飞书中演示 **两个独立 OpenClaw Agent**（同一 `user_id`、不同 `agent_id`）、共同连接 **同一个 powermem-server（HTTP API v2）** 时的 **跨 Agent 记忆分享**流程。适用于你已分别把两个 OpenClaw 接入两个飞书机器人的场景。

---

## 1. 架构约定

| 维度 | 机器人 A | 机器人 B |
|------|-----------|-----------|
| 飞书 | 独立应用 / 独立机器人 | 独立应用 / 独立机器人 |
| OpenClaw | 独立网关或独立 Agent 入口 | 同上 |
| PowerMem `user_id`（插件配置） | **与 B 完全一致** | **与 A 完全一致** |
| PowerMem `agent_id`（插件配置） | **唯一，例如 `feishu-agent-alpha`** | **唯一，例如 `feishu-agent-beta`** |
| powermem-server | **同一实例、同一 Base URL（v2）** | 同上 |

记忆在存储里仍是一条「属于发布方 agent」的记录；分享给另一方时，在 **`metadata.shared_with`** 中写入接收方 **`agent_id`**（服务端落库）。接收方列出「分享给我的」依赖 **同一 `user_id` + 接收方 `agent_id` + `shared`** 索引逻辑。

---

## 2. 前置检查清单

在开始演示前确认：

1. **powermem-server**  
   - 对外地址可达（两台 OpenClaw 所在机器均可访问）。  
   - 使用 **API v2**（插件侧 `httpApiVersion: "v2"`）。  
   - 若启用鉴权，两台 OpenClaw 使用 **同一套可用凭据**（如 `apiKey`）。

2. **memory-powermem 插件（两台 OpenClaw 均需）**  
   - `mode: "http"`，`baseUrl` 指向上述同一服务根路径（不含 `/api/v1`）。  
   - `httpApiVersion: "v2"`。  
   - **`userId`**：两台配置为 **同一字符串**（演示租户用户；不要用默认各自随机生成却不一致）。  
   - **`agentId`**：两台分别为 **不同字符串**，且与下文话术中的「源 / 目标」一致（或与你在飞书里约定的名称一致）。

3. **飞书侧**  
   - 两个机器人分别能收到消息并路由到对应 OpenClaw。  
   - 演示账号建议固定为同一飞书用户（便于「同一 user 下两 agent」的语义一致）。

4. **插件版本**  
   - 使用已支持 **`agent_memory_share` / `agent_memory_shared`** 且在调用 shared 接口时 **携带 `user_id`** 的客户端版本（与当前 powermem-server v2 行为配套）。

---

## 3. OpenClaw 配置示例（两台仅差异 `agentId`）

以下仅为结构示例，路径与字段名以你实际 `openclaw.json` / 插件配置为准。

**机器人 A（发布方 / Agent Alpha）**

```json
{
  "plugins": {
    "slots": { "memory": "memory-powermem" },
    "entries": {
      "memory-powermem": {
        "enabled": true,
        "config": {
          "mode": "http",
          "baseUrl": "http://your-powermem-host:8000",
          "httpApiVersion": "v2",
          "apiKey": "可选",
          "userId": "demo-tenant-user",
          "agentId": "feishu-agent-alpha"
        }
      }
    }
  }
}
```

**机器人 B（接收方 / Agent Beta）**

```json
{
  "plugins": {
    "slots": { "memory": "memory-powermem" },
    "entries": {
      "memory-powermem": {
        "enabled": true,
        "config": {
          "mode": "http",
          "baseUrl": "http://your-powermem-host:8000",
          "httpApiVersion": "v2",
          "apiKey": "可选",
          "userId": "demo-tenant-user",
          "agentId": "feishu-agent-beta"
        }
      }
    }
  }
}
```

修改配置后需 **重启对应 OpenClaw Gateway**，使两台均加载新 `userId` / `agentId`。

---

## 4. 演示流程（建议在飞书中按顺序操作）

### 阶段一：在机器人 A 写入一条可辨识的记忆

在 **机器人 A** 的对话中发送（可按需改写口令）：

- 「请把下面这句话记入长期记忆：**本次飞书演示口令是【灯塔-07】**，后续要在另一个机器人里验证。」  
- 或明确要求工具：「使用 **memory_store** 写入：**本次飞书演示口令是【灯塔-07】**。」

**预期**：记忆写入 **Alpha** 命名空间（`agent_id = feishu-agent-alpha`），且 `user_id` 为你在插件里配置的租户 id。

---

### 阶段二：在机器人 A 发起「分享给 Beta」

仍在 **机器人 A** 中发送（将目标 id 换成你在 B 侧配置的 `agentId`）：

- 「请调用 **agent_memory_share**，把我的记忆分享给 **`feishu-agent-beta`**（分享全部即可）。」  
- 若模型询问记忆 id：可先让它 **列出当前 Agent 记忆** 再分享指定 id；全量分享也可不传具体 `memory_ids`（视服务端与插件约定）。

**预期**：服务端在对应记忆的 **`metadata.shared_with`** 中加入 `feishu-agent-beta`，且不依赖单次请求的内存权限（已持久化则由 server 可查）。

---

### 阶段三：在机器人 B 查看「分享给我的」

在 **机器人 B** 的对话中发送：

- 「请使用 **agent_memory_shared**，列出当前 Agent 收到的共享记忆。」

**预期**：列表中出现 **仍为 Alpha 拥有**、但 **`shared_with` 包含 Beta** 的那条记录（内容里含「灯塔-07」或相关摘要）。

---

### 阶段四（可选）：在机器人 B 用检索验证

在 **机器人 B** 中：

- 「用 **memory_recall** 搜索：**灯塔-07**。」

**预期**：在同一 `user_id` 且检索链路支持「owner 或 shared_with」的前提下，Beta 侧可检索到来自 Alpha 的分享内容（若你部署的 server 已对检索做过分享语义扩展）。若检索未命中而 **agent_memory_shared** 能列出，多半属于检索过滤策略差异，以 **shared 列表**为分享成功的首要判据。

---

## 5. 演示话术小结（便于照读）

| 步骤 | 在哪个机器人 | 示例话术 |
|------|----------------|----------|
| 写入 | A | 「写入长期记忆：我有一支魔法铅笔」 |
| 分享 | A | 「执行 agent_memory_share，目标 agent 为 feishu-agent-beta」 |
| 列共享 | B | 「执行 agent_memory_shared，列出共享记忆」 |
| 检索（可选） | B | 「memory_recall 搜索：我有魔法铅笔吗」 |

将示例中的 **`feishu-agent-alpha` / `feishu-agent-beta`** 替换为你配置文件中的真实 **`agentId`**。

---

## 6. 常见问题

**Q：两台 OpenClaw 已设同一 `userId`，但 B 仍看不到分享？**

- 确认 **A 侧分享成功后** 再操作 B；确认 **`userId` 字符串完全一致**（无空格、大小写一致）。  
- 确认两台 **`baseUrl`、`httpApiVersion: v2`** 指向同一 powermem-server。  
- 在 server 日志或数据库中查看该条记忆 **`metadata.shared_with`** 是否包含 Beta 的 `agent_id`。

**Q：能否用两个飞书用户演示？**

- 可以接两个机器人，但 PowerMem 侧 **`user_id` 由插件配置决定**，与「几个飞书用户」无自动绑定；若你希望「同一租户」语义，应保持插件 **`userId` 一致**；若你希望隔离租户，应使用 **不同 `userId`**（此时跨用户分享需其它能力如 `cross_scope_share`，与本篇「同 user 跨 agent」不同）。

**Q：`agent_memory_share` 报错 fromAgentId 不匹配？**

- 插件约定：**分享发起方必须是当前会话对应的 Agent**。只能在 **机器人 A** 的对话里发起「从 Alpha 分享到 Beta」，不要在 B 的对话里冒充 A。

---

## 7. 演示成功的判定标准（最小集）

1. A 写入的记忆在 server 上 **`user_id` + `agent_id=alpha`** 可查。  
2. 分享成功后，该条 **`metadata.shared_with`** 含 **`feishu-agent-beta`**（或你的 Beta id）。  
3. 在 B 的对话中 **`agent_memory_shared`** 能列出该条（或摘要中出现口令关键词）。

满足以上三条即可认为 **同一 powermem-server、同一 user_id、不同 agent_id 的飞书双机器人演示闭环成立**。
