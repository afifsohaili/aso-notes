import type { WebSocket } from 'ws'

export interface WsMessage {
  type: string
  payload: any
}

class WebSocketConnectionManager {
  private connections: Map<string, Set<WebSocket>> = new Map()

  addConnection(userId: string, ws: WebSocket): void {
    if (!this.connections.has(userId)) {
      this.connections.set(userId, new Set())
    }
    this.connections.get(userId)!.add(ws)
  }

  removeConnection(userId: string, ws: WebSocket): void {
    const userConnections = this.connections.get(userId)
    if (userConnections) {
      userConnections.delete(ws)
      if (userConnections.size === 0) {
        this.connections.delete(userId)
      }
    }
  }

  broadcastToUser(userId: string, eventType: string, payload: any): void {
    const userConnections = this.connections.get(userId)
    if (!userConnections || userConnections.size === 0) return

    const message = JSON.stringify({ type: eventType, payload })

    for (const ws of userConnections) {
      if (ws.readyState === ws.OPEN) {
        try {
          ws.send(message)
        }
        catch {
          // Ignore send errors
        }
      }
    }
  }
}

// Singleton instance
export const wsManager = new WebSocketConnectionManager()
