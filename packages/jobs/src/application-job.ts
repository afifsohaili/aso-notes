export interface JobOpts {
  delay?: number
  priority?: number
  jobId?: string
  attempts?: number
  backoff?: { type: string, delay: number }
  removeOnComplete?: boolean | number | { age?: number, count?: number }
  removeOnFail?: boolean | number | { age?: number, count?: number }
  [key: string]: unknown
}

export interface JobAdapter {
  enqueue: (queueName: string, jobName: string, data: unknown, opts?: JobOpts) => Promise<void>
}

export interface ApplicationJobClass<Data = unknown> {
  queueName: string
  new (): ApplicationJob<Data>
}

let activeAdapter: JobAdapter | undefined

export function registerJobAdapter(adapter: JobAdapter): void {
  activeAdapter = adapter
}

export function getActiveJobAdapter(): JobAdapter | undefined {
  return activeAdapter
}

const jobRegistry = new Map<string, ApplicationJobClass>()

export function registerJob(jobClass: ApplicationJobClass): void {
  jobRegistry.set(jobClass.name, jobClass)
}

export function getJobClass(name: string): ApplicationJobClass | undefined {
  return jobRegistry.get(name)
}

export function listRegisteredJobs(): ApplicationJobClass[] {
  return Array.from(jobRegistry.values())
}

export abstract class ApplicationJob<Data = unknown> {
  static queueName: string = ''

  static performLater(
    this: ApplicationJobClass,
    data: unknown,
    opts?: JobOpts,
  ): Promise<void> {
    registerJob(this)

    const adapter = getActiveJobAdapter()
    if (!adapter) {
      throw new Error(
        `No job adapter registered. Call registerJobAdapter() before enqueueing ${this.name}.`,
      )
    }

    if (!this.queueName) {
      throw new Error(`${this.name}.queueName is not set`)
    }

    return adapter.enqueue(this.queueName, this.name, data, opts)
  }

  abstract perform(data: Data): Promise<void>
}
