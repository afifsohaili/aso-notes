/**
 * Data structure for email sending jobs
 */
export interface EmailJobData {
  to: string
  subject: string
  text?: string
  html?: string
}

/**
 * Interface for email sending providers
 * Implementations must provide:
 * - sendEmail(job: EmailJobData): Promise<EmailResponse>
 */
export interface EmailProvider {
  sendEmail: (job: EmailJobData) => Promise<EmailResponse>
}

/**
 * Response from an email sending operation
 */
export interface EmailResponse {
  messageId: string
  provider: string
}
