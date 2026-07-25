import type { EmailJobData } from './email/interface'
import { useQueue } from '../utils/queue'

export { BrevoEmailProvider } from './email/brevo'
export type { EmailJobData, EmailProvider, EmailResponse } from './email/interface'
export { MailpitEmailProvider } from './email/mailpit'
export { BREVO_PROVIDER, EMAIL_PROVIDER, getProvider, MAILPIT_PROVIDER, PROVIDER_CONFIGS, providers, sendEmail } from './email/providers'

export const EMAIL_QUEUE_NAME = 'email'

/**
 * Enqueue an email job to be processed by the email worker.
 * This function is non-blocking and returns immediately.
 *
 * Redis is optional infrastructure: when NUXT_REDIS_URL is not set
 * (e.g. tests, minimal environments), this degrades to a logged no-op
 * instead of throwing.
 */
export async function enqueueEmail(data: EmailJobData) {
  if (!process.env.NUXT_REDIS_URL) {
    console.warn(`NUXT_REDIS_URL is not set; skipping email to ${data.to} (subject: ${data.subject})`)
    return
  }
  const emailQueue = useQueue<EmailJobData>(EMAIL_QUEUE_NAME)
  return emailQueue.add('send-email', data)
}
