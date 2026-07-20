export type QueueMode = 'fake' | 'inline' | 'real'

export interface EnqueuedJob {
  queue: string
  name: string
  data: unknown
  opts?: Record<string, unknown>
}

export interface QueueTestingFacade {
  setMode: (mode: QueueMode) => void
  enqueuedJobs: (queue?: string) => EnqueuedJob[]
  performEnqueuedJobs: (queue?: string, opts?: { includeDelayed?: boolean }) => Promise<void>
  reset: () => void
}
