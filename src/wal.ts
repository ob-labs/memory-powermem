/**
 * WAL (Write-Ahead Capture) — Incremental memory capture during conversations.
 */

export const WAL_EXTRACT_PROMPT = `You are a quick fact extractor. Given a single user message, extract 1-3 key facts worth remembering long-term.

Rules:
- Keep each fact short and specific.
- Only include stable preferences, decisions, corrections, or commitments.
- Skip greetings, filler, or transient chit-chat.
- Output ONLY valid JSON: {"facts":["fact1","fact2"]}`;

export const WAL_SIGNAL_PATTERNS = [
  /我(喜欢|偏好|习惯|倾向|prefer|like|always use)/i,
  /(就用|决定|选择|不要|不用|let's use|go with|decided)/i,
  /(不对|错了|应该是|其实是|actually|correction)/i,
  /(deadline|截止|前完成|by tomorrow|due date|下周|明天)/i,
  /(i (like|prefer|love|hate|always|never|want to))\b/i,
  /(remember that|don't forget|keep in mind|note that)/i,
];

export function detectKeySignals(text: string): boolean {
  return WAL_SIGNAL_PATTERNS.some((re) => re.test(text));
}

export interface WalDeps {
  callLlm: (prompt: string, opts: {
    systemPrompt: string;
    maxTokens: number;
    temperature: number;
  }) => Promise<string | null>;
  store: (content: string, metadata: Record<string, unknown>) => Promise<{ id?: string | number }>;
  logger: {
    info?: (msg: string) => void;
    warn: (msg: string) => void;
  };
}

export class WalSession {
  private readonly cache = new Map<string, Set<string>>();

  has(sessionKey: string, fact: string): boolean {
    const set = this.cache.get(sessionKey);
    return set ? set.has(fact) : false;
  }

  add(sessionKey: string, fact: string): void {
    const set = this.cache.get(sessionKey) ?? new Set<string>();
    set.add(fact);
    this.cache.set(sessionKey, set);
  }

  clear(sessionKey: string): void {
    this.cache.delete(sessionKey);
  }
}

function stripThinkBlocks(raw: string): string {
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function normalizeFact(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function parseWalFacts(raw: string | null): string[] {
  if (!raw) return [];
  const cleaned = stripThinkBlocks(raw);
  if (!cleaned) return [];

  const attempts = [cleaned];
  const jsonMatch = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch && jsonMatch[1] !== cleaned) {
    attempts.unshift(jsonMatch[1]);
  }

  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt);
      if (Array.isArray(parsed)) {
        return parsed.filter((item) => typeof item === "string").map(normalizeFact);
      }
      if (parsed && typeof parsed === "object") {
        const facts = (parsed as { facts?: unknown }).facts;
        if (Array.isArray(facts)) {
          return facts.filter((item) => typeof item === "string").map(normalizeFact);
        }
      }
    } catch {
      // fall through
    }
  }

  return cleaned
    .split("\n")
    .map((line) => line.replace(/^[-*\d.\s]+/, "").trim())
    .filter((line) => line.length > 0)
    .map(normalizeFact);
}

export async function walCapture(
  prompt: string,
  sessionKey: string,
  session: WalSession,
  deps: WalDeps,
): Promise<Array<string | number>> {
  if (!detectKeySignals(prompt)) return [];

  const reply = await deps.callLlm(prompt, {
    systemPrompt: WAL_EXTRACT_PROMPT,
    maxTokens: 512,
    temperature: 0.1,
  });
  const facts = parseWalFacts(reply)
    .map(normalizeFact)
    .filter((fact) => fact.length >= 8)
    .slice(0, 3)
    .filter((fact) => !session.has(sessionKey, fact));

  if (facts.length === 0) return [];

  const storedIds: Array<string | number> = [];
  for (const fact of facts) {
    try {
      const result = await deps.store(fact, {
        source: "wal",
        session: sessionKey,
      });
      if (result?.id !== undefined) {
        storedIds.push(result.id);
      }
      session.add(sessionKey, fact);
    } catch (err) {
      deps.logger.warn(`memory-powermem: wal capture failed: ${String(err)}`);
    }
  }

  deps.logger.info?.(`memory-powermem: wal captured ${storedIds.length} fact(s)`);
  return storedIds;
}
