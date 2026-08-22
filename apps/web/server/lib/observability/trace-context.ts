import type { TraceOptions } from '../ai/types'

/**
 * Shared context used by any traced pipeline that produces a sequence of
 * Generations inside one Trace. Consumers call `buildTraceOptions` to turn one
 * step of this context into the `TraceOptions` passed to provider calls.
 */
export interface TraceContext {
  traceId: string
  workspaceId: string
  useCase: string
  nextSeq: () => number
}

export function buildTraceOptions(ctx: TraceContext): TraceOptions {
  return {
    traceId: ctx.traceId,
    workspaceId: ctx.workspaceId,
    useCase: ctx.useCase,
    seq: ctx.nextSeq(),
  }
}
