import { createHash } from 'node:crypto'

/**
 * Content hash used for change detection, the rename guard, and the
 * ingested_hash skip rule (plan-002-system §Sync service). sha256 hex of the
 * raw file bytes decoded as utf8.
 */
export function contentHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}
