/**
 * Minimal shared fetch helper. Deliberately thin — each provider's query params,
 * pagination, and response shape are different enough that a heavier shared HTTP
 * client would add more indirection than it saves.
 */
export async function fetchJson<T>(
  url: string | URL,
  init: RequestInit & { signal: AbortSignal },
): Promise<{ data: T; response: Response }> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`Request to ${url} failed with status ${response.status}`);
  }
  const data = (await response.json()) as T;
  return { data, response };
}
