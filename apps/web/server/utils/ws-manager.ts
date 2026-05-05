import type { Peer } from 'crossws'

export interface WsMessage {
  type: string
  payload: any
}

class WebSocketConnectionManager {
  private connections: Map<string, Set<Peer>> = new Map()

  addConnection(userId: string, peer: Peer): void {
    if (!this.connections.has(userId)) {
      this.connections.set(userId, new Set())
    }
    this.connections.get(userId)!.add(peer)
  }

  removeConnection(userId: string, peer: Peer): void {
    const userConnections = this.connections.get(userId)
    if (userConnections) {
      userConnections.delete(peer)
      if (userConnections.size === 0) {
        this.connections.delete(userId)
      }
    }
  }

  broadcastToUser(userId: string, eventType: string, payload: any): void {
    const userConnections = this.connections.get(userId)
    if (!userConnections || userConnections.size === 0) return

    const message = JSON.stringify({ type: eventType, payload })

    for (const peer of userConnections) {
      try {
        peer.send(message)
      }
      catch {
        // Ignore send errors
      }
    }
  }
}

// Singleton instance
export const wsManager = new WebSocketConnectionManager()
