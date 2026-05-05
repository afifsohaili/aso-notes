import type { Peer } from 'crossws'
import { wsManager } from '~~/server/utils/ws-manager'
import { useAuth } from '~~/utils/auth'

export default defineWebSocketHandler({
  async open(peer) {
    try {
      const auth = useAuth(useRuntimeConfig())
      const headers = new Headers()

      // Extract cookies from peer request
      const cookie = peer.request.headers.get('cookie')
      if (cookie) {
        headers.set('cookie', cookie)
      }

      const session = await auth.api.getSession({
        headers,
      })

      if (!session?.user) {
        peer.close(1008, 'Unauthorized')
        return
      }

      // Store user ID on peer context for later use
      peer.context.userId = session.user.id
      wsManager.addConnection(session.user.id, peer)
    }
    catch {
      peer.close(1008, 'Unauthorized')
    }
  },

  close(peer) {
    const userId = peer.context?.userId as string | undefined
    if (userId) {
      wsManager.removeConnection(userId, peer)
    }
  },

  message(peer, message) {
    const text = message.text()
    if (text === 'ping') {
      peer.send('pong')
    }
  },
})
