import type { EmailJobData, EmailProvider, EmailResponse } from './interface'
import process from 'node:process'

const MAILPIT_PROVIDER = 'mailpit'

/**
 * Mailpit Email Provider
 * Sends emails via Mailpit's HTTP API for testing/monitoring
 */
export class MailpitEmailProvider implements EmailProvider {
  private smtpServer: string
  private smtpPort: number

  constructor() {
    this.smtpServer = 'localhost'
    this.smtpPort = 8025
  }

  async sendEmail(job: EmailJobData): Promise<EmailResponse> {
    console.warn(`Sending email via Mailpit SMTP to ${job.to}`)

    const emailData = {
      from: {
        email: process.env.NUXT_SENDER_EMAIL || 'noreply@example.com',
        name: process.env.NUXT_SENDER_NAME || 'No Reply',
      },
      to: [
        {
          email: job.to,
          name: job.to.split('@')[0],
        },
      ],
      subject: job.subject,
      HTML: job.html || job.text || '',
      Text: job.text,
    }

    try {
      // Mailpit uses /api/v1/send endpoint
      const response = await $fetch<{ ID: string }>(`http://${this.smtpServer}:${this.smtpPort}/api/v1/send`, {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'content-type': 'application/json',
        },
        body: emailData,
        timeout: 30000,
      })

      console.warn(`Email sent successfully via Mailpit to ${job.to}:`, {
        messageId: response.ID,
      })

      return {
        messageId: response.ID,
        provider: MAILPIT_PROVIDER,
      }
    }
    catch (error) {
      console.error(`Mailpit SMTP error for ${job.to}:`, {
        error: error instanceof Error ? error.message : error,
        status: (error as any)?.status,
        statusText: (error as any)?.statusText,
        data: (error as any)?.data,
      })
      throw error
    }
  }
}
