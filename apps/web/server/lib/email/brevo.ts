import type { EmailJobData, EmailProvider, EmailResponse } from './interface'
import process from 'node:process'

const BREVO_PROVIDER = 'brevo'

/**
 * Brevo (SendinBlue) Email Provider
 * Uses the Brevo SMTP API to send emails
 */
export class BrevoEmailProvider implements EmailProvider {
  private apiKey: string
  private senderEmail: string
  private senderName: string

  constructor() {
    this.apiKey = process.env.NUXT_BREVO_API_KEY || ''
    this.senderEmail = process.env.NUXT_SENDER_EMAIL || process.env.NUXT_BREVO_SENDER_EMAIL || ''
    this.senderName = process.env.NUXT_SENDER_NAME || process.env.NUXT_BREVO_SENDER_NAME || 'No Reply'
  }

  async sendEmail(job: EmailJobData): Promise<EmailResponse> {
    if (!this.apiKey || !this.senderEmail) {
      throw new Error('Brevo API key or sender email not configured')
    }

    console.warn(`Sending email via Brevo API to ${job.to}`)

    const emailData = {
      sender: {
        name: this.senderName,
        email: this.senderEmail,
      },
      to: [
        {
          email: job.to,
          name: job.to.split('@')[0],
        },
      ],
      subject: job.subject,
      htmlContent: job.html || job.text || '',
      textContent: job.text,
    }

    try {
      const response = await $fetch<{ messageId: string }>('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'api-key': this.apiKey,
          'content-type': 'application/json',
        },
        body: emailData,
        timeout: 30000,
      })

      console.warn(`Email sent successfully via Brevo API to ${job.to}:`, {
        messageId: response.messageId,
      })

      return {
        messageId: response.messageId,
        provider: BREVO_PROVIDER,
      }
    }
    catch (error) {
      console.error(`Brevo API error for ${job.to}:`, {
        error: error instanceof Error ? error.message : error,
        status: (error as any)?.status,
        statusText: (error as any)?.statusText,
        data: (error as any)?.data,
      })
      throw error
    }
  }
}
