import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export const DEFAULT_MARKDOWN_IMPORT_PATHS = ["memory", "MEMORY.md", "USER.md"] as const;

type MarkdownImportClient = {
  add: (
    content: string,
    options?: { infer?: boolean; metadata?: Record<string, unknown> },
  ) => Promise<Array<{ memory_id: string | number; content: string }>>;
};

type Logger = { info?: (msg: string) => void; warn?: (msg: string) => void };

type MarkdownImportMarker = {
  version: 1;
  imports: Record<
    string,
    {
      completedAt: string;
      workspaceDir: string;
      paths: string[];
      files: number;
      chunks: number;
      created: number;
      limited?: boolean;
      fileDetails?: MarkdownImportFileDetail[];
    }
  >;
};

export type MarkdownImportFileStatus =
  | "imported"
  | "dry_run"
  | "skipped_empty"
  | "skipped_too_large"
  | "read_failed"
  | "limited";

export type MarkdownImportFileDetail = {
  path: string;
  size: number;
  mtimeMs: number;
  sha256?: string;
  status: MarkdownImportFileStatus;
  chunks: number;
  created: number;
  error?: string;
};

export type MarkdownImportResult = {
  skipped: boolean;
  reason?: string;
  markerKey: string;
  files: number;
  chunks: number;
  created: number;
  paths: string[];
  limited: boolean;
  fileDetails: MarkdownImportFileDetail[];
};

export type MarkdownImportStatusEntry = {
  path: string;
  size: number;
  mtimeMs: number;
  status:
    | MarkdownImportFileStatus
    | "imported_changed"
    | "not_imported";
  chunks: number;
  created: number;
  importedAt?: string;
  error?: string;
};

export type MarkdownImportStatus = {
  markerKey: string;
  imported: boolean;
  completedAt?: string;
  workspaceDir: string;
  paths: string[];
  files: MarkdownImportStatusEntry[];
};

export type MarkdownImportOptions = {
  client: MarkdownImportClient;
  markerPath: string;
  markerKey: string;
  workspaceDir?: string;
  paths?: readonly string[];
  infer: boolean;
  force?: boolean;
  dryRun?: boolean;
  source: "startup" | "cli";
  maxFileBytes?: number;
  maxChunkChars?: number;
  maxFiles?: number;
  maxChunks?: number;
  batchDelayMs?: number;
  logger?: Logger;
};

const DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_CHUNK_CHARS = 6000;

export function buildMarkdownImportMarkerKey(params: {
  userId: string;
  agentId: string;
  workspaceDir?: string;
  paths: readonly string[];
}): string {
  const payload = JSON.stringify({
    userId: params.userId,
    agentId: params.agentId,
    workspaceDir: params.workspaceDir ? resolve(params.workspaceDir) : "",
    paths: params.paths.map((p) => p.trim()).filter(Boolean),
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 24);
}

export async function importMarkdownMemories(
  opts: MarkdownImportOptions,
): Promise<MarkdownImportResult> {
  const sourcePaths = normalizeSourcePaths(opts.paths);
  const workspaceDir = opts.workspaceDir ? resolve(opts.workspaceDir) : process.cwd();
  const marker = loadMarker(opts.markerPath);
  if (!opts.force && marker.imports[opts.markerKey]) {
    return {
      skipped: true,
      reason: "already_imported",
      markerKey: opts.markerKey,
      files: 0,
      chunks: 0,
      created: 0,
      paths: sourcePaths,
      limited: false,
      fileDetails: marker.imports[opts.markerKey].fileDetails ?? [],
    };
  }

  const collectedFiles = collectMarkdownFiles(sourcePaths, workspaceDir, opts.maxFileBytes);
  const fileDetails: MarkdownImportFileDetail[] = collectedFiles
    .filter((file) => file.status === "skipped_too_large")
    .map((file) => ({
      path: relative(workspaceDir, file.path) || file.path,
      size: file.size,
      mtimeMs: file.mtimeMs,
      status: "skipped_too_large",
      chunks: 0,
      created: 0,
      error: "file exceeds maxFileBytes",
    }));
  const eligibleFiles = collectedFiles.filter((file) => file.status === "eligible");
  const maxFiles = normalizePositiveLimit(opts.maxFiles);
  const files = maxFiles === undefined ? eligibleFiles : eligibleFiles.slice(0, maxFiles);
  if (files.length === 0) {
    return {
      skipped: true,
      reason: "no_markdown_files",
      markerKey: opts.markerKey,
      files: 0,
      chunks: 0,
      created: 0,
      paths: sourcePaths,
      limited: false,
      fileDetails,
    };
  }

  const maxChunkChars = opts.maxChunkChars ?? DEFAULT_MAX_CHUNK_CHARS;
  const maxChunks = normalizePositiveLimit(opts.maxChunks);
  const batchDelayMs = normalizeDelayMs(opts.batchDelayMs);
  const limitedByFiles = maxFiles !== undefined && eligibleFiles.length > files.length;
  let limitedByChunks = false;
  let chunkCount = 0;
  let createdCount = 0;
  const importedAt = new Date().toISOString();

  if (limitedByFiles) {
    for (const file of eligibleFiles.slice(files.length)) {
      fileDetails.push(createFileDetail(file, workspaceDir, "limited", 0, 0));
    }
  }

  for (const file of files) {
    if (maxChunks !== undefined && chunkCount >= maxChunks) {
      limitedByChunks = true;
      fileDetails.push(createFileDetail(file, workspaceDir, "limited", 0, 0));
      break;
    }
    let content = "";
    try {
      content = readFileSync(file.path, "utf-8").trim();
    } catch (err) {
      opts.logger?.warn?.(`memory-powermem: markdown import skipped ${file.path}: ${String(err)}`);
      fileDetails.push(createFileDetail(file, workspaceDir, "read_failed", 0, 0, String(err)));
      continue;
    }
    if (!content) {
      fileDetails.push(createFileDetail(file, workspaceDir, "skipped_empty", 0, 0));
      continue;
    }

    const chunks = splitMarkdown(content, maxChunkChars);
    const fileStartedChunkCount = chunkCount;
    let fileCreatedCount = 0;
    let fileLimited = false;
    for (let i = 0; i < chunks.length; i++) {
      if (maxChunks !== undefined && chunkCount >= maxChunks) {
        limitedByChunks = true;
        fileLimited = true;
        break;
      }
      chunkCount += 1;
      if (opts.dryRun) continue;

      const created = await opts.client.add(chunks[i], {
        infer: opts.infer,
        metadata: {
          source: "markdown-import",
          import_source: opts.source,
          imported_at: importedAt,
          file_path: relative(workspaceDir, file.path) || file.path,
          chunk_index: i + 1,
          chunk_total: chunks.length,
        },
      });
      createdCount += created.length;
      fileCreatedCount += created.length;
      if (batchDelayMs > 0) {
        await sleep(batchDelayMs);
      }
    }
    fileDetails.push(
      createFileDetail(
        file,
        workspaceDir,
        fileLimited ? "limited" : opts.dryRun ? "dry_run" : "imported",
        chunkCount - fileStartedChunkCount,
        fileCreatedCount,
        undefined,
        opts.dryRun ? undefined : hashContent(content),
      ),
    );
  }

  if (!opts.dryRun) {
    marker.imports[opts.markerKey] = {
      completedAt: importedAt,
      workspaceDir,
      paths: sourcePaths,
      files: files.length,
      chunks: chunkCount,
      created: createdCount,
      limited: limitedByFiles || limitedByChunks,
      fileDetails,
    };
    saveMarker(opts.markerPath, marker);
  }

  return {
    skipped: false,
    markerKey: opts.markerKey,
    files: files.length,
    chunks: chunkCount,
    created: createdCount,
    paths: sourcePaths,
    limited: limitedByFiles || limitedByChunks,
    fileDetails,
  };
}

export function getMarkdownImportStatus(params: {
  markerPath: string;
  markerKey: string;
  workspaceDir?: string;
  paths?: readonly string[];
  maxFileBytes?: number;
}): MarkdownImportStatus {
  const sourcePaths = normalizeSourcePaths(params.paths);
  const workspaceDir = params.workspaceDir ? resolve(params.workspaceDir) : process.cwd();
  const marker = loadMarker(params.markerPath);
  const batch = marker.imports[params.markerKey];
  const detailsByPath = new Map<string, MarkdownImportFileDetail>();
  for (const detail of batch?.fileDetails ?? []) {
    detailsByPath.set(detail.path, detail);
  }
  const currentFiles = collectMarkdownFiles(sourcePaths, workspaceDir, params.maxFileBytes);
  const files = currentFiles.map((file): MarkdownImportStatusEntry => {
    const relPath = relative(workspaceDir, file.path) || file.path;
    const previous = detailsByPath.get(relPath);
    if (file.status === "skipped_too_large") {
      return {
        path: relPath,
        size: file.size,
        mtimeMs: file.mtimeMs,
        status: "skipped_too_large",
        chunks: previous?.chunks ?? 0,
        created: previous?.created ?? 0,
        importedAt: batch?.completedAt,
        error: previous?.error ?? "file exceeds maxFileBytes",
      };
    }
    if (!previous) {
      return {
        path: relPath,
        size: file.size,
        mtimeMs: file.mtimeMs,
        status: "not_imported",
        chunks: 0,
        created: 0,
      };
    }
    const changed = previous.size !== file.size || previous.mtimeMs !== file.mtimeMs;
    return {
      path: relPath,
      size: file.size,
      mtimeMs: file.mtimeMs,
      status: changed && previous.status === "imported" ? "imported_changed" : previous.status,
      chunks: previous.chunks,
      created: previous.created,
      importedAt: batch?.completedAt,
      error: previous.error,
    };
  });
  for (const previous of batch?.fileDetails ?? []) {
    if (!files.some((file) => file.path === previous.path)) {
      files.push({
        path: previous.path,
        size: previous.size,
        mtimeMs: previous.mtimeMs,
        status: previous.status,
        chunks: previous.chunks,
        created: previous.created,
        importedAt: batch?.completedAt,
        error: "not found in current scan",
      });
    }
  }
  return {
    markerKey: params.markerKey,
    imported: Boolean(batch),
    completedAt: batch?.completedAt,
    workspaceDir,
    paths: sourcePaths,
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
  };
}

function normalizeSourcePaths(paths: readonly string[] | undefined): string[] {
  const normalized = (paths && paths.length > 0 ? paths : DEFAULT_MARKDOWN_IMPORT_PATHS)
    .map((p) => p.trim())
    .filter(Boolean);
  return normalized.length > 0 ? normalized : [...DEFAULT_MARKDOWN_IMPORT_PATHS];
}

type MarkdownFileCandidate = {
  path: string;
  size: number;
  mtimeMs: number;
  status: "eligible" | "skipped_too_large";
};

function collectMarkdownFiles(
  sourcePaths: readonly string[],
  workspaceDir: string,
  maxFileBytes = DEFAULT_MAX_FILE_BYTES,
): MarkdownFileCandidate[] {
  const out: MarkdownFileCandidate[] = [];
  const seen = new Set<string>();
  for (const sourcePath of sourcePaths) {
    const abs = resolveImportPath(sourcePath, workspaceDir);
    collectOne(abs, out, seen, maxFileBytes);
  }
  return out.sort();
}

function collectOne(
  absPath: string,
  out: MarkdownFileCandidate[],
  seen: Set<string>,
  maxFileBytes: number,
): void {
  if (!existsSync(absPath)) return;
  const st = statSync(absPath);
  if (st.isFile()) {
    if (absPath.toLowerCase().endsWith(".md") && !seen.has(absPath)) {
      seen.add(absPath);
      out.push({
        path: absPath,
        size: st.size,
        mtimeMs: st.mtimeMs,
        status: st.size <= maxFileBytes ? "eligible" : "skipped_too_large",
      });
    }
    return;
  }
  if (!st.isDirectory()) return;

  for (const entry of readdirSync(absPath, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    collectOne(join(absPath, entry.name), out, seen, maxFileBytes);
  }
}

function resolveImportPath(input: string, workspaceDir: string): string {
  const expanded = input === "~" ? homedir() : input.replace(/^~(?=\/)/, homedir());
  return isAbsolute(expanded) ? resolve(expanded) : resolve(workspaceDir, expanded);
}

function splitMarkdown(content: string, maxChunkChars: number): string[] {
  if (content.length <= maxChunkChars) return [content];
  const paragraphs = content.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length <= maxChunkChars) {
      current = next;
      continue;
    }
    if (current) chunks.push(current);
    if (paragraph.length <= maxChunkChars) {
      current = paragraph;
      continue;
    }
    for (let i = 0; i < paragraph.length; i += maxChunkChars) {
      chunks.push(paragraph.slice(i, i + maxChunkChars));
    }
    current = "";
  }
  if (current) chunks.push(current);
  return chunks.map((c) => c.trim()).filter(Boolean);
}

function normalizePositiveLimit(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const n = Math.floor(value);
  return n > 0 ? n : undefined;
}

function normalizeDelayMs(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(60000, Math.floor(value)));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function createFileDetail(
  file: MarkdownFileCandidate,
  workspaceDir: string,
  status: MarkdownImportFileStatus,
  chunks: number,
  created: number,
  error?: string,
  sha256?: string,
): MarkdownImportFileDetail {
  return {
    path: relative(workspaceDir, file.path) || file.path,
    size: file.size,
    mtimeMs: file.mtimeMs,
    sha256,
    status,
    chunks,
    created,
    error,
  };
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function loadMarker(markerPath: string): MarkdownImportMarker {
  try {
    const parsed = JSON.parse(readFileSync(markerPath, "utf-8"));
    if (parsed?.version === 1 && parsed.imports && typeof parsed.imports === "object") {
      return parsed as MarkdownImportMarker;
    }
  } catch {
    // Missing or invalid marker: start fresh.
  }
  return { version: 1, imports: {} };
}

function saveMarker(markerPath: string, marker: MarkdownImportMarker): void {
  mkdirSync(dirname(markerPath), { recursive: true });
  writeFileSync(markerPath, JSON.stringify(marker, null, 2), "utf-8");
}
