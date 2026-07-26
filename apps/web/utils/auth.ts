import type { Users } from '@monorepo/shared'
import type { Selectable } from 'kysely'
import process from 'node:process'
import { betterAuth } from 'better-auth'
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
      // Dev environments have no outgoing email provider configured, so skip
      // verification and let the user use the app immediately.
      requireEmailVerification: process.env.NODE_ENV !== 'development',
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
    databaseHooks: {
      user: {
        create: {
          after: async (user: Selectable<Users>) => {
            try {
              const name = user.name || user.email.split('@')[0]
              const [workspace] = await db
                .insertInto('workspaces')
                .values({ name: `${name}'s Workspace` })
                .returning(['id'])
                .execute()

              await db
                .insertInto('memberships')
                .values({ user_id: user.id, workspace_id: workspace.id, role: 'admin' })
                .execute()
            }
            catch (error) {
              console.error('Failed to create workspace for new user:', error)
            }
          },
        },
      },
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
