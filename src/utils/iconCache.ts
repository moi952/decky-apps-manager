/**
 * Module-level icon cache — persists for the lifetime of the plugin session.
 * Key: app id, Value: base64 data URL or "" (not found)
 */
const cache = new Map<string, string>();

export function getCachedIcon(id: string): string | undefined {
  return cache.get(id);
}

export function setCachedIcon(id: string, url: string): void {
  cache.set(id, url);
}
