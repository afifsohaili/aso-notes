import type { PipelineId, Stage, StageId } from './types'

/**
 * Singleton registry of pipeline stages. Stages are registered at boot with
 * constructor-injected dependencies (see createStageRegistry); pipelines
 * reference stages by string id and are validated against the registry at
 * boot so a typo fails fast instead of mid-ingestion.
 */
export class StageRegistry {
  private readonly stages = new Map<StageId, Stage>()

  register(stage: Stage): void
  register(id: StageId, stage: Stage): void
  register(idOrStage: StageId | Stage, maybeStage?: Stage): void {
    const stage = maybeStage ?? (idOrStage as Stage)
    const id = maybeStage ? (idOrStage as StageId) : stage.id
    if (stage.id !== id)
      throw new Error(`stage id mismatch: registered as '${id}' but stage.id is '${stage.id}'`)
    this.stages.set(id, stage)
  }

  get(id: StageId): Stage {
    const stage = this.stages.get(id)
    if (!stage)
      throw new Error(`unregistered stage: '${id}'`)
    return stage
  }

  has(id: StageId): boolean {
    return this.stages.has(id)
  }
}

/**
 * Boot-time validation: every stage id referenced by every pipeline must
 * resolve in the registry. Throws naming the offending pipeline and id.
 */
export function validatePipelines(
  registry: StageRegistry,
  pipelines: Record<PipelineId, StageId[]>,
): void {
  for (const [pipelineId, stageIds] of Object.entries(pipelines)) {
    for (const stageId of stageIds) {
      if (!registry.has(stageId))
        throw new Error(`pipeline '${pipelineId}' references unregistered stage '${stageId}'`)
    }
  }
}
