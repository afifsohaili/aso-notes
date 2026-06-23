# Product Specification: Telegram Membership SaaS

## Vision
A multi-tenant SaaS platform that automates paid community access across messaging platforms. Members pay creators to gain access to private channels, and are automatically removed when their membership expires or payment is past due. Initially launching with Telegram, with architecture that supports Discord, Slack, WhatsApp, and other community platforms in the future.

## Core Concept
- **Grant**: After successful payment, a member is automatically granted access to a private channel
- **Revoke**: When a membership expires or payment is past due, a member is automatically removed from the channel
- **Multi-Tenant**: Each organization can manage multiple channels across multiple platforms and sell memberships to their members
- **Multi-Platform**: A channel can live on Telegram, Discord, Slack, WhatsApp, or any future supported platform
- **No Bundling**: Each channel is billed separately. Subscribing to one channel does not grant access to other channels owned by the same organization.

## Guidelines

### Ubiquitous Language in Code and Database
All domain terms in this glossary MUST be used consistently in:
- Database table and column names
- TypeScript types, interfaces, and enums
- API route names and function names
- UI copy and user-facing language
- Documentation and comments

Avoid synonyms in code. If the glossary says **Membership**, do not use `subscription`, `access`, or `tier` in code.

## Glossary

| Term | Definition | Code / DB Preference |
| ---- | ---------- | -------------------- |
| **Organization** | A tenant/account that owns channels and sells memberships | `organizations` table |
| **Platform** | A messaging service where communities live (e.g. Telegram, Discord) | `platforms` enum / `channels.platform` |
| **Channel** | A specific community on a platform (Telegram channel, Discord server, WhatsApp group) | `channels` table |
| **Member** | A paying subscriber who gets access to one or more channels | `members` table |
| **Plan** | A pricing and billing interval for a channel (e.g. monthly $10) | `channel_plans` table |
| **Membership** | A member's ongoing access to a channel under a plan | `channel_memberships` table |
| **Payment** | A financial transaction that creates or extends a membership | `payments` table |
| **Access** | The right to be in a channel for a specific time window | Derived from active membership |
| **Grant** | Action of adding a member to a channel | Function / worker action (platform-specific implementation) |
| **Revoke** | Action of removing a member from a channel | Function / worker action (platform-specific implementation) |
| **Renewal** | Extending a membership via a new payment | Membership lifecycle event |
| **Past Due** | A membership whose payment has failed or expired | Membership status: `past_due` |
| **Graced Past Due** | A past due membership still within the 3-day grace period | Membership status: `graced_past_due` |

## Relationships

- An **Organization** has many **Channels**
- An **Organization** has many **Members**
- An **Organization** has many **Organization Memberships** (team members / employees of the creator)
- A **Channel** belongs to one **Organization** and one **Platform**
- A **Channel** has many **Plans**
- A **Member** belongs to one **Organization**
- A **Member** can have many **Memberships**
- A **Membership** links one **Member** to one **Channel Plan**
- A **Membership** has many **Payments**

## Tech Stack (Existing)
- **Frontend**: Nuxt.js 3, Tailwind CSS, TypeScript, Vue 3 Composition API
- **Backend**: Nitro (Nuxt server), Kysely ORM, PostgreSQL
- **Auth**: BetterAuth (email/password with verification)
- **Multi-tenancy**: Organizations + Memberships tables already implemented
- **Queue**: Existing email worker/queue system (BullMQ-like)
- **Testing**: Vitest with e2e support
- **Payments**: Stripe + Stripe Connect

## Existing Infrastructure
- User authentication with email verification
- Organization creation on signup (each user gets their own org)
- Role-based organization memberships (admin/member)
- Admin panel scaffold
- Notifications system
- Email queue/worker
- Database migrations pipeline

## Decisions Made

1. **Payment Provider**: Stripe with Stripe Connect
2. **Customer Flow**: Members pay the organization directly. The platform facilitates via Stripe Connect.
3. **Telegram Integration**: One platform bot for Telegram (extendable to Discord bot, Slack app, etc.)
4. **Member Authentication**: Members do not log into the app. They only interact with payment checkout. Their platform user info (e.g. Telegram user ID) is stored in the `members` table.
5. **Organization Memberships**: Existing `memberships` table represents organization team members / creator employees.
6. **Channel Memberships**: New `channel_memberships` table represents a member's paid access to a channel.
7. **Membership Model**: Both subscription (monthly/yearly) and one-time payment plans supported from launch.
8. **Telegram Channel Types**: Private channels and private groups.
9. **Grant Method**: Direct add via platform bot.
10. **Member Identification**: Bot deep-link flow before checkout. Member clicks bot link → starts bot → gets checkout URL with their platform user ID embedded.
11. **Platform Extensibility**: Schema designed for multi-platform now; implement Telegram only. Grant/revoke logic uses strategy pattern with a shared interface.
12. **Stripe Connect Type**: Express accounts.
13. **SaaS Pricing**: RM39 per month per channel. Weekly payouts to organization's bank account. No bundling across channels.
14. **One-Time Plan Duration**: One-time payment grants lifetime access to the channel (no automatic expiry).
15. **Payouts**: Automated via Stripe Connect.
16. **Frontend Scope** (MVP admin dashboard):
    - Connect Telegram channel
    - Create/edit plans
    - View members + memberships
    - Payouts overview

## Open Questions / Need Decisions

All initial product decisions resolved. Ready to move to architecture and implementation planning.

## Assumptions
- Each organization manages one or more channels
- A channel belongs to one platform (Telegram, Discord, etc.)
- Payment triggers automatic channel access
- Expired or past due membership triggers automatic removal
- The platform handles payment webhooks and platform bot interactions
- Past due memberships get a 3-day grace period before access is revoked
- One platform bot handles all channels on that platform globally
- Platform-specific grant/revoke logic is abstracted behind a common interface
- Each channel is billed independently; there is no cross-channel bundling
- One-time plans grant lifetime access with no automatic expiry
