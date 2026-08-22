/**
 * Shared display formatters for LLM observability UI.
 */

/**
 * Format a token count for display: 1.2M, 3.4k, or the raw integer.
 */
export function formatTokens(n: number): string {
  if (n >= 1_000_000)
    return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000)
    return `${(n / 1000).toFixed(1)}k`
  return `${n}`
}

/**
 * Format a duration in milliseconds: 1.2s, or Nms. `null` renders as an em dash.
 */
export function formatMs(ms: number | null): string {
  if (ms === null)
    return '—'
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}

/**
 * Format a USD cost string. `null`/empty renders as an em dash.
 *
 * Precision is unified across the trace UI and the usage summary: costs of one
 * dollar or more render as $X.XX; sub-dollar costs render as $X.XXXX (four
 * decimal places, e.g. $0.0003). All three original call sites used four
 * decimals for sub-dollar values (LLM per-generation costs are typically far
 * below a dollar, so four decimals preserve useful precision), and the usage
 * summary added a `>= $1 → $X.XX` guard that is adopted here for costs that
 * cross the one-dollar mark.
 */
export function formatCost(costUsd: string | null): string {
  if (costUsd === null || costUsd === '')
    return '—'
  const n = Number.parseFloat(costUsd)
  if (Number.isNaN(n))
    return '—'
  if (n >= 1)
    return `$${n.toFixed(2)}`
  return `$${n.toFixed(4)}`
}
