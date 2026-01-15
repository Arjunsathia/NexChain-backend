const WebSocket = require("ws");
const jwt = require("jsonwebtoken");
const url = require("url");

class SocketService {
  constructor() {
    this.wss = null;
    this.clientStates = new WeakMap();
  }

  init(server) {
    this.wss = new WebSocket.Server({ server });

    this.wss.on("connection", (ws, req) => {
      // 1. Extract Token from Query Params
      const parameters = url.parse(req.url, true);
      let token = parameters.query.token;

      if (Array.isArray(token)) {
        token = token[0];
      }

      if (!token) {
        // Allow anonymous connection ONLY if your app supports public streams without auth.
        // For NexChain, we want to enforce auth for user-specific streams.
        // However, if there are public ticker streams, you might need to handle them differently.
        // Assuming this socket is primarily for USER NOTIFICATIONS (Order updates), we require auth.
        // If the frontend opens a separate "public" socket for prices, that's fine (served by Binance proxy maybe).
        
        // For now, if no token, mark as anonymous (or close if strict).
        // Let's close for security as per audit plan.
        ws.close(1008, "Authentication token required");
        return;
      }

      // 2. Verify Token
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        if (typeof decoded === 'string' || !decoded.id) {
          throw new Error("Invalid token payload");
        }

        // 3. Store User ID
        this.clientStates.set(ws, { isAlive: true, userId: decoded.id });
      } catch (err) {
        ws.close(1008, "Invalid Token");
        return;
      }

      ws.on("close", () => {
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
    if (!this.wss) return;

    const message = JSON.stringify({ type, data });
    
    this.wss.clients.forEach((client) => {
      const state = this.clientStates.get(client);
      
      // CRITICAL SECURITY FIX: Only send if the connected socket belongs to the target userId
      if (
        client.readyState === WebSocket.OPEN &&
        state &&
        state.userId === userId
      ) {
        client.send(message);
      }
    });
  }
}

const socketService = new SocketService();
module.exports = socketService;
