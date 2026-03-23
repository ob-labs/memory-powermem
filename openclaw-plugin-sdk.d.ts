/**
 * Minimal type declarations for openclaw plugin-sdk so the extension type-checks
 * without installing openclaw (faster CI). Runtime resolves via openclaw's loader.
 */
declare module "openclaw/plugin-sdk/memory-core" {
  type CommandChain = {
    command: (name: string, description?: string) => CommandChain;
    description: (desc: string) => CommandChain;
    argument: (name: string, description?: string) => CommandChain;
    option: (flags: string, description?: string, defaultValue?: string) => CommandChain;
    action: (fn: (...args: unknown[]) => void | Promise<void>) => CommandChain;
  };

  export type OpenClawPluginCliContext = {
    program: {
      command: (name: string, description?: string) => CommandChain;
    };
    config: unknown;
    logger: { info: (msg: string) => void; warn: (msg: string) => void; debug?: (msg: string) => void };
  };

  type ServiceContext = {
    config: unknown;
    workspaceDir?: string;
    stateDir: string;
    logger: { info: (msg: string) => void; warn: (msg: string) => void };
  };

  export type OpenClawPluginApi = {
    /** Full gateway config (OpenClaw ≥ ~2026.3); used to derive LLM keys for memory plugins. */
    config?: unknown;
    runtime?: {
      state?: { resolveStateDir?: (env?: NodeJS.ProcessEnv) => string };
      modelAuth?: {
        resolveApiKeyForProvider?: (params: {
          provider: string;
          cfg?: unknown;
        }) => Promise<{ apiKey?: string }>;
      };
    };
    pluginConfig?: Record<string, unknown>;
    logger: { info: (msg: string) => void; warn: (msg: string) => void; debug?: (msg: string) => void };
    registerTool: (tool: unknown, opts?: { name?: string; names?: string[] }) => void;
    registerCli: (
      registrar: (ctx: OpenClawPluginCliContext) => void | Promise<void>,
      opts?: { commands?: string[] },
    ) => void;
    on: (hookName: string, handler: (event: unknown) => unknown | Promise<unknown>) => void;
    registerService: (service: {
      id: string;
      start: (ctx: ServiceContext) => void | Promise<void>;
      stop?: (ctx: ServiceContext) => void;
    }) => void;
  };
}

declare module "openclaw/plugin-sdk" {
  export type OpenClawPluginServiceContext = {
    config: unknown;
    workspaceDir?: string;
    stateDir: string;
    logger: { info: (msg: string) => void; warn: (msg: string) => void };
  };
}
