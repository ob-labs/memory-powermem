/**
 * PowerMem HTTP API v2 client.
 * Uses /api/v2 endpoints and per-request config.
 */

import type { PowerMemConfig } from "./config.js";
import { fetchWithTimeout } from "./http.js";
import type { PowerMemAddResult, PowerMemSearchResult } from "./client.js";

export type PowermemRequestConfig = Record<string, unknown>;

type ApiResponse<T> = {
  success: boolean;
  data?: T;
  message?: string;
};

export type PowerMemV2ClientOptions = {
  baseUrl: string;
  apiKey?: string;
  userId?: string;
  agentId?: string;
  requestConfig?: PowermemRequestConfig;
  timeoutMs?: number;
};

function buildUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

function buildHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["X-API-Key"] = apiKey;
  }
  return headers;
}

async function handleResponse<T>(res: Response, parseJson = true): Promise<T> {
  const text = await res.text();
  if (!res.ok) {
    let message = `PowerMem API ${res.status}: ${res.statusText}`;
    try {
      const body = text ? JSON.parse(text) : null;
      if (body?.message) message = body.message;
      else if (body?.detail) {
        message = Array.isArray(body.detail)
          ? body.detail.map((d: { msg?: string }) => d.msg ?? String(d)).join("; ")
          : String(body.detail);
      }
    } catch {
      if (text) message = text.slice(0, 200);
    }
    throw new Error(message);
  }
  if (!parseJson) return undefined as T;
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

function normalizeMemoryId(value: unknown): string | number {
  if (value === null || value === undefined) return "";
  const str = String(value);
  return str.trim() !== "" ? str : "";
}

export class PowerMemV2Client {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly userId: string;
  private readonly agentId: string;
  private readonly requestConfig?: PowermemRequestConfig;
  private readonly timeoutMs: number;

  constructor(options: PowerMemV2ClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.userId = options.userId ?? "openclaw-user";
    this.agentId = options.agentId ?? "openclaw-agent";
    this.requestConfig = options.requestConfig;
    this.timeoutMs = options.timeoutMs ?? 30000;
  }

  static fromConfig(cfg: PowerMemConfig, userId: string, agentId: string): PowerMemV2Client {
    return new PowerMemV2Client({
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      userId,
      agentId,
      requestConfig: cfg.requestConfig,
      timeoutMs: cfg.requestTimeoutMs,
    });
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    parseJson = true,
  ): Promise<T> {
    const url = buildUrl(this.baseUrl, path);
    const res = await fetchWithTimeout(url, {
      method,
      headers: buildHeaders(this.apiKey),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }, this.timeoutMs);
    return handleResponse<T>(res, parseJson);
  }

  private buildConfigPayload(): { config?: PowermemRequestConfig } {
    if (!this.requestConfig) return {};
    return { config: this.requestConfig };
  }

  /** GET /api/v2/system/health */
  async health(): Promise<{ status: string; error?: string }> {
    try {
      const data = await this.request<ApiResponse<{ status?: string }>>(
        "GET",
        "/api/v2/system/health",
        undefined,
      );
      return { status: data?.data?.status ?? "unknown" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { status: "unhealthy", error: msg };
    }
  }

  /** POST /api/v2/memories */
  async add(
    content: string,
    options: { infer?: boolean; metadata?: Record<string, unknown> } = {},
  ): Promise<PowerMemAddResult[]> {
    const body = {
      content,
      user_id: this.userId,
      agent_id: this.agentId,
      infer: options.infer ?? true,
      ...(options.metadata && { metadata: options.metadata }),
      ...this.buildConfigPayload(),
    };
    const res = await this.request<ApiResponse<Array<Record<string, unknown>>>>(
      "POST",
      "/api/v2/memories",
      body,
    );
    const rows = res?.data ?? [];
    return rows.map((row) => ({
      memory_id: normalizeMemoryId(row.memory_id ?? row.id),
      content: String(row.content ?? ""),
      user_id: row.user_id as string | undefined,
      agent_id: row.agent_id as string | undefined,
      metadata: row.metadata as Record<string, unknown> | undefined,
    }));
  }

  /** POST /api/v2/memories/search */
  async search(query: string, limit = 5): Promise<PowerMemSearchResult[]> {
    const body = {
      query,
      user_id: this.userId,
      agent_id: this.agentId,
      limit,
      ...this.buildConfigPayload(),
    };
    const res = await this.request<ApiResponse<{ results?: PowerMemSearchResult[] }>>(
      "POST",
      "/api/v2/memories/search",
      body,
    );
    const rows = res?.data?.results ?? [];
    return rows.map((row) => ({
      ...row,
      memory_id: normalizeMemoryId(row.memory_id),
    }));
  }

  /** POST /api/v2/memories/delete/{id} */
  async delete(memoryId: number | string): Promise<void> {
    const id = typeof memoryId === "string" ? memoryId : String(memoryId);
    const body = {
      user_id: this.userId,
      agent_id: this.agentId,
      ...this.buildConfigPayload(),
    };
    await this.request(
      "POST",
      `/api/v2/memories/delete/${encodeURIComponent(id)}`,
      body,
      false,
    );
  }

  /** POST /api/v2/agents/{agent_id}/memories */
  async agentMemoryAdd(
    targetAgentId: string,
    content: string,
  ): Promise<PowerMemAddResult | null> {
    const body = {
      content,
      user_id: this.userId,
      agent_id: this.agentId,
      ...this.buildConfigPayload(),
    };
    const res = await this.request<ApiResponse<Record<string, unknown>>>(
      "POST",
      `/api/v2/agents/${encodeURIComponent(targetAgentId)}/memories`,
      body,
    );
    if (!res?.data) return null;
    return {
      memory_id: normalizeMemoryId(res.data.memory_id ?? res.data.id),
      content: String(res.data.content ?? ""),
      user_id: res.data.user_id as string | undefined,
      agent_id: res.data.agent_id as string | undefined,
      metadata: res.data.metadata as Record<string, unknown> | undefined,
    };
  }

  /** POST /api/v2/agents/{agent_id}/memories/list */
  async agentMemoryList(
    targetAgentId: string,
    limit = 20,
    offset = 0,
  ): Promise<Array<Record<string, unknown>>> {
    const body = {
      limit,
      offset,
      ...this.buildConfigPayload(),
    };
    const res = await this.request<ApiResponse<{ memories?: Array<Record<string, unknown>> }>>(
      "POST",
      `/api/v2/agents/${encodeURIComponent(targetAgentId)}/memories/list`,
      body,
    );
    return res?.data?.memories ?? [];
  }

  /** POST /api/v2/agents/{agent_id}/memories/share */
  async agentMemoryShare(
    fromAgentId: string,
    targetAgentId: string,
    memoryIds?: number[],
  ): Promise<{ shared_count?: number }> {
    const body = {
      target_agent_id: targetAgentId,
      ...(memoryIds && memoryIds.length > 0 ? { memory_ids: memoryIds } : {}),
      ...this.buildConfigPayload(),
    };
    const res = await this.request<ApiResponse<Record<string, unknown>>>(
      "POST",
      `/api/v2/agents/${encodeURIComponent(fromAgentId)}/memories/share`,
      body,
    );
    return { shared_count: Number(res?.data?.shared_count ?? 0) };
  }

  /** POST /api/v2/agents/{agent_id}/memories/shared */
  async agentMemoryShared(
    targetAgentId: string,
    limit = 20,
    offset = 0,
  ): Promise<Array<Record<string, unknown>>> {
    const body = {
      limit,
      offset,
      user_id: this.userId,
      ...this.buildConfigPayload(),
    };
    const res = await this.request<ApiResponse<{ memories?: Array<Record<string, unknown>> }>>(
      "POST",
      `/api/v2/agents/${encodeURIComponent(targetAgentId)}/memories/shared`,
      body,
    );
    return res?.data?.memories ?? [];
  }
}
