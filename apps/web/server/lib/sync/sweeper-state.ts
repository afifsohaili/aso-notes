/**
 * Sweeper heartbeat state (plan-004 Phase 2 O5).
 *
 * In-memory singleton updated by runSweeperOnce. It intentionally is not
 * persisted to the database: a 30-second sweep cadence would generate noisy
 * writes, and the heartbeat is only useful for live operator diagnostics.
 *
 * Single-process assumption: the sweeper runs in the same Nitro process as the
 * API that reads this state. A future multi-process deployment would need a
 * shared store (Redis / a tiny DB table) instead.
 */
export interface SweeperState {
  /** ISO timestamp of the last completed sweep, or null before the first sweep. */
  lastSweepAt: string | null
  /** Number of notes successfully dispatched during the last sweep. */
  lastDispatched: number
  /** Number of notes whose dispatch threw during the last sweep. */
  lastFailed: number
}

let state: SweeperState = {
  lastSweepAt: null,
  lastDispatched: 0,
  lastFailed: 0,
}

/** Replace the heartbeat state with a new sweep result (counts only). */
export function recordSweeperHeartbeat(result: { dispatched: string[], failed: string[] }): void {
  state = {
    lastSweepAt: new Date().toISOString(),
    lastDispatched: result.dispatched.length,
    lastFailed: result.failed.length,
  }
}

/** Read-only view of the current heartbeat state. */
export function getSweeperState(): Readonly<SweeperState> {
  return state
}

/** Reset state — useful in tests that assert on heartbeat values. */
export function resetSweeperState(): void {
  state = {
    lastSweepAt: null,
    lastDispatched: 0,
    lastFailed: 0,
  }
}
