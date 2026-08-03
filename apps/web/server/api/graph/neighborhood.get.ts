import { useDatabase } from '~~/utils/db'
import { getEgoGraph } from '../../lib/graph/ui'
import { resolveWorkspaceId } from '../../utils/workspace'

export default defineEventHandler(async (event) => {
  if (!event.context.user) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const config = useRuntimeConfig(event)
  const db = useDatabase(config)
  const workspaceId = await resolveWorkspaceId(db, event.context.user.id)

  if (!workspaceId) {
    return { nodes: [], edges: [] }
  }

  const query = getQuery(event)
  const nodeId = typeof query.node === 'string' ? query.node : undefined
  if (!nodeId) {
    throw createError({ statusCode: 400, statusMessage: 'node is required' })
  }

  const parsedDepth = Number.parseInt(String(query.depth ?? ''), 10)
  const depth = Number.isNaN(parsedDepth) ? 1 : Math.min(2, Math.max(1, parsedDepth))

  return getEgoGraph(db, workspaceId, nodeId, depth)
})
