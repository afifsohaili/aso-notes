import process from 'node:process'
import { useQueue } from '../utils/queue'

export interface EmailJobData {
  to: string
  subject: string
  text?: string
  html?: string
}

interface BrevoEmailResponse {
  messageId: string
}

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

/**
 * Send an email via Brevo API.
 * Requires NUXT_BREVO_API_KEY and NUXT_BREVO_SENDER_EMAIL env vars.
 */
export async function sendEmail(options: EmailJobData) {
  const apiKey = process.env.NUXT_BREVO_API_KEY
  const senderEmail = process.env.NUXT_BREVO_SENDER_EMAIL
  const senderName = process.env.NUXT_BREVO_SENDER_NAME || 'No Reply'

  if (!apiKey) {
    throw new Error('NUXT_BREVO_API_KEY is not defined')
  }
  if (!senderEmail) {
    throw new Error('NUXT_BREVO_SENDER_EMAIL is not defined')
  }

  console.warn(`Sending email via Brevo API to ${options.to}`)

  const emailData = {
    sender: {
      name: senderName,
      email: senderEmail,
    },
    to: [
      {
        email: options.to,
        name: options.to.split('@')[0],
      },
    ],
    subject: options.subject,
    htmlContent: options.html || options.text || '',
    textContent: options.text,
  }

  try {
    const response = await $fetch<BrevoEmailResponse>('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': apiKey,
        'content-type': 'application/json',
      },
      body: emailData,
      timeout: 30000,
    })

    console.warn(`Email sent successfully via Brevo API to ${options.to}:`, {
      messageId: response.messageId,
    })

    return response
  }
  catch (error) {
    console.error(`Brevo API error for ${options.to}:`, {
      error: error instanceof Error ? error.message : error,
      status: (error as any)?.status,
      statusText: (error as any)?.statusText,
      data: (error as any)?.data,
    })
    throw error
  }
}
