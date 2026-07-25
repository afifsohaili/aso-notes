import type { EmailJobData, EmailProvider, EmailResponse } from './interface'
import process from 'node:process'
import { BrevoEmailProvider } from './brevo'
import { MailpitEmailProvider } from './mailpit'

// Provider names
export const BREVO_PROVIDER = 'brevo'
export const MAILPIT_PROVIDER = 'mailpit'

// Get configured email provider from environment variable
// Defaults to 'brevo' in production, 'mailpit' in test environments
export const EMAIL_PROVIDER = (process.env.NUXT_EMAIL_PROVIDER as string) || (process.env.NODE_ENV === 'test' ? MAILPIT_PROVIDER : BREVO_PROVIDER)

// Provider configurations
export const PROVIDER_CONFIGS = {
  [BREVO_PROVIDER]: {
    apiKey: process.env.NUXT_BREVO_API_KEY,
    senderEmail: process.env.NUXT_SENDER_EMAIL || process.env.NUXT_BREVO_SENDER_EMAIL,
    senderName: process.env.NUXT_SENDER_NAME || process.env.NUXT_BREVO_SENDER_NAME || 'No Reply',
  },
  [MAILPIT_PROVIDER]: {
    smtpServer: 'localhost',
    smtpPort: 8025,
  },
} as const

// Map of provider names to provider instances
export const providers: Record<string, EmailProvider> = {
  [BREVO_PROVIDER]: new BrevoEmailProvider(),
  [MAILPIT_PROVIDER]: new MailpitEmailProvider(),
}

/**
 * Get an email provider by name
 * @param provider - Provider name (brevo, mailpit)
 * @returns EmailProvider instance
 * @throws Error if provider is unknown
 */
export function getProvider(provider: string): EmailProvider {
  if (!providers[provider]) {
    throw new Error(`Unknown provider: ${provider}`)
  }
  return providers[provider]
}

/**
 * Send email using the configured provider
 * @param job - Email job data
 * @param provider - Optional provider name to override default
 * @returns Email response with messageId
 */
export async function sendEmail(job: EmailJobData, provider?: string): Promise<EmailResponse> {
  // Use provided provider if specified, otherwise use configured default
  const selectedProvider = provider || EMAIL_PROVIDER

  if (selectedProvider === BREVO_PROVIDER) {
    return providers[BREVO_PROVIDER].sendEmail(job)
  }
  if (selectedProvider === MAILPIT_PROVIDER) {
    return providers[MAILPIT_PROVIDER].sendEmail(job)
  }

  throw new Error(`Invalid provider: ${selectedProvider}`)
}
