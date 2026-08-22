import { enqueueEmail } from '../lib/email'

export default defineEventHandler(async () => {
  const job = await enqueueEmail({
    to: 'test@example.com',
    subject: 'Test Email from BullMQ',
    text: 'This is a test email to verify the queue is working.',
    html: '<p>This is a test email to verify the queue is working.</p>',
  })

  return {
    success: true,
    jobId: job!.id,
    message: 'Email job added to queue',
  }
})
