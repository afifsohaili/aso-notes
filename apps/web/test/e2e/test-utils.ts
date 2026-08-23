/**
 * Shared e2e test helpers for the settings specs.
 *
 * `normalizeFetchUrl` unwraps the fetch URL from whatever shape the global
 * `fetch` stub receives (string, URL, or Request), so per-test assertions can
 * check the path uniformly without re-implementing the unwrap each time.
 */
export function normalizeFetchUrl(url: string | URL | Request): string {
  return typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
}
