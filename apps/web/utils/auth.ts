import { betterAuth } from 'better-auth'
import { createAuthMiddleware } from 'better-auth/api'
import { enqueueEmail } from '../server/lib/email'
import { useDatabase } from './db'

interface AuthEnv {
  databaseUrl: string
  redisUrl?: string
  [key: string]: string | undefined
  public?: {
    [key: string]: string | undefined
  }
}

export function useAuth(env: AuthEnv) {
  const db = useDatabase(env)
  // Create and export the auth instance
  const auth = betterAuth({
    database: {
      db,
      type: 'postgres',
    },
    baseURL: env.public.siteUrl,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      sendResetPassword: async ({ user, url }) => {
        // Don't await to prevent timing attacks
        void enqueueEmail({
          to: user.email,
          subject: 'Reset your password',
          text: `Click the link to reset your password: ${url}`,
          html: `<p>Click the link to reset your password: <a href="${url}">${url}</a></p>`,
        })
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendVerificationEmail: async ({ user, url }) => {
        // Don't await to prevent timing attacks
        void enqueueEmail({
          to: user.email,
          subject: 'Verify your email address',
          text: `Click the link to verify your email: ${url}`,
          html: `<p>Click the link to verify your email: <a href="${url}">${url}</a></p>`,
        })
      },
      autoSignInAfterVerification: true,
    },
    user: { modelName: 'users' },
    session: { modelName: 'sessions' },
    account: { modelName: 'accounts' },
    verification: { modelName: 'user_verifications' },
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path.startsWith('/sign-up')) {
          const session = ctx.context.newSession
          const user = session?.user
          // Create a default organization for new users
          if (user) {
            try {
              // Create a new organization for the user
              const [organization] = await db
                .insertInto('organizations')
                .values({ name: `${user.name}'s Organization` })
                .returning(['id', 'name', 'created_at', 'updated_at'])
                .execute()

              // Add the user as an admin to the organization
              await db
                .insertInto('memberships')
                .values({ user_id: user.id, organization_id: organization.id, role: 'admin' })
                .execute()
            }
            catch (error) {
              console.error('Failed to create organization for new user:', error)
            }
          }
        }
      }),
    },
    // You can add social providers if needed
    // socialProviders: {
    //   github: {
    //     clientId: process.env.GITHUB_CLIENT_ID,
    //     clientSecret: process.env.GITHUB_CLIENT_SECRET,
    //   }
    // }
  })

  return auth
}
