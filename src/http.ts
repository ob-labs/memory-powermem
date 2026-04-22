export async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs?: number,
): Promise<Response> {
  const timeout = typeof timeoutMs === "number" ? timeoutMs : 0;
  if (!timeout || timeout <= 0) {
    return fetch(url, options);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
