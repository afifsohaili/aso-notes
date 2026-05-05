import type { Job } from 'bullmq'
import type { EmailJobData } from '../lib/email'
import { EMAIL_QUEUE_NAME, sendEmail } from '../lib/email'

export default defineNitroPlugin(() => {
  // skip initialising worker on pre-render
  if (import.meta.prerender)
    return

  const worker = useWorker(
    EMAIL_QUEUE_NAME,
    async (job: Job<EmailJobData>) => {
      const data = job.data

      console.warn(`Processing email job ${job.id}: to=${data.to}, subject=${data.subject}`)

      try {
        await sendEmail(data)
        console.warn(`Email job ${job.id} completed successfully`)
      }
      catch (error) {
        console.error(`Email job ${job.id} failed:`, error)
        throw error // Re-throw to let BullMQ handle retries
      }
    },
    {
      concurrency: 5,
    },
  )

  worker.on('failed', (job: Job | undefined, err: Error) => {
    console.error(`Email job ${job?.id} failed after retries:`, err.message)
  })

  worker.on('completed', (job: Job) => {
    console.warn(`Email job ${job.id} completed`)
  })

  console.warn('Email worker initialized')
})
