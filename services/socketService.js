const WebSocket = require("ws");

class SocketService {
  constructor() {
    this.wss = null;
    this.clientStates = new WeakMap();
  }

  init(server) {
    this.wss = new WebSocket.Server({ server });

    this.wss.on("connection", (ws) => {
      console.log("📱 [Socket] Client connected");
      this.clientStates.set(ws, { isAlive: true });

      ws.on("close", () => {
        console.log("📱 [Socket] Client disconnected");
        this.clientStates.delete(ws);
      });

      ws.on('pong', () => { 
        const state = this.clientStates.get(ws);
        if (state) state.isAlive = true;
      });
    });

    // Heartbeat interval
    setInterval(() => {
      this.wss.clients.forEach((ws) => {
        const state = this.clientStates.get(ws);
        if (!state || state.isAlive === false) return ws.terminate();
        state.isAlive = false;
        ws.ping();
      });
    }, 30000);
  }

  /**
   * Send a message to all connected clients
   * @param {string} type - Message type (e.g., 'ORDER_FILLED')
   * @param {Object} data - Payload
   */
  broadcast(type, data) {
    if (!this.wss) return;

    const message = JSON.stringify({ type, data });
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  /**
   * Send a message to a specific user
   * @param {string} userId - User ID to target
   * @param {string} type - Message type
   * @param {Object} data - Payload
   */
  sendToUser(userId, type, data) {
    // We broadcast and let the frontend filter by targetUserId
    this.broadcast(type, { ...data, targetUserId: userId });
  }
}

const socketService = new SocketService();
module.exports = socketService;
