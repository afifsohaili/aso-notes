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
 */
export async function enqueueEmail(data: EmailJobData) {
  const emailQueue = useQueue<EmailJobData>(EMAIL_QUEUE_NAME)
  return emailQueue.add('send-email', data)
}
