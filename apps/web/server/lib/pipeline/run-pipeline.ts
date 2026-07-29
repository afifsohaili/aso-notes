import type { PipelineContext } from './context'
import type { StageRegistry } from './registry'
import type { PipelineId, StageId } from './types'
import { PIPELINES } from './ids'
import { getStageRegistry } from './singleton'

export interface RunPipelineOptions {
  registry: StageRegistry
  pipelines: Record<PipelineId, StageId[]>
}

/**
 * Execute a pipeline: invoke each stage in order with the shared context.
 * Any stage failure aborts the run — the failure model is atomic per note
 * per content version, and the BullMQ job retries from the top.
 */
export async function runPipeline(
  pipelineId: PipelineId,
  ctx: PipelineContext,
  options?: RunPipelineOptions,
): Promise<PipelineContext> {
  const registry = options?.registry ?? getStageRegistry()
  const pipelines = options?.pipelines ?? PIPELINES

  const stageIds = pipelines[pipelineId]
  if (!stageIds)
    throw new Error(`unknown pipeline: '${pipelineId}'`)

  ctx.startedAt = new Date()

  for (const stageId of stageIds) {
    ctx.currentStage = stageId
    await registry.get(stageId).invoke(ctx)
  }

  return ctx
}
