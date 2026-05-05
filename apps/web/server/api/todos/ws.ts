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

      // Store user ID on peer for later use
      peer.ctx.userId = session.user.id
      wsManager.addConnection(session.user.id, peer.websocket as any)
    }
    catch {
      peer.close(1008, 'Unauthorized')
    }
  },

  close(peer) {
    if (peer.ctx.userId) {
      wsManager.removeConnection(peer.ctx.userId, peer.websocket as any)
    }
  },

  message(peer, message) {
    const text = message.text()
    if (text === 'ping') {
      peer.send('pong')
    }
  },
})
