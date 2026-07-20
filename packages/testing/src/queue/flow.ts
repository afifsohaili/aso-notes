import { getJobClass } from '@base/jobs'

export interface FlowChildDef {
  queue: string
  name: string
  data: unknown
  opts?: Record<string, unknown>
}

export interface FlowDef {
  name: string
  queue: string
  data: unknown
  opts?: Record<string, unknown>
  children: FlowChildDef[]
}

export class FlowBuilder {
  private children: FlowChildDef[] = []

  addChild(queue: string, name: string, data: unknown, opts?: Record<string, unknown>): void {
    this.children.push({ queue, name, data, opts })
  }

  build(name: string, queue: string, data: unknown, opts?: Record<string, unknown>): FlowDef {
    return { name, queue, data, opts, children: this.children }
  }
}

const flowRegistry = new Map<string, FlowDef>()

export function defineFlow(
  name: string,
  build: (builder: FlowBuilder) => { queue: string, data: unknown, opts?: Record<string, unknown> },
): FlowDef {
  const builder = new FlowBuilder()
  const { queue, data, opts } = build(builder)
  const flow = builder.build(name, queue, data, opts)
  flowRegistry.set(name, flow)
  return flow
}

export function getFlow(name: string): FlowDef | undefined {
  return flowRegistry.get(name)
}

export async function runFlowInline(flow: FlowDef): Promise<void> {
  // Execute children first, then the parent. This mirrors BullMQ FlowProducer
  // semantics and works because tests run in-process.
  for (const child of flow.children) {
    const jobClass = getJobClass(child.name)
    if (!jobClass) {
      throw new Error(
        `Flow child job "${child.name}" is not registered. ` +
        'Ensure the ApplicationJob subclass is imported before running the flow.',
      )
    }
    const instance = new jobClass()
    await instance.perform(child.data)
  }

  const parentClass = getJobClass(flow.name)
  if (!parentClass) {
    throw new Error(
      `Flow parent job "${flow.name}" is not registered. ` +
      'Ensure the ApplicationJob subclass is imported before running the flow.',
    )
  }
  const instance = new parentClass()
  await instance.perform(flow.data)
}
