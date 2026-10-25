const WebSocket = require("ws");
const User = require("../Models/userModel");
const { verifyAccessToken } = require("../utils/tokens");

// Clients authenticate with their first message: {"type":"AUTH","token":"<access token>"}.
// The token is not put in the URL, where proxies and access logs would record it.
const AUTH_TIMEOUT_MS = 10000;

class SocketService {
  constructor() {
    this.wss = null;
    this.clientStates = new WeakMap();
  }

  init(server) {
    this.wss = new WebSocket.Server({ server });

    this.wss.on("connection", (ws) => {
      const state = { isAlive: true, userId: null };
      this.clientStates.set(ws, state);

      const authTimer = setTimeout(() => {
        if (!state.userId) ws.close(4401, "Authentication required");
      }, AUTH_TIMEOUT_MS);

      ws.on("message", async (raw) => {
        if (state.userId) return; // only the auth message is expected from clients

        let message;
        try {
          message = JSON.parse(raw.toString());
        } catch {
          return ws.close(4400, "Invalid message");
        }
        if (message?.type !== "AUTH") return ws.close(4401, "Authentication required");

        const decoded = verifyAccessToken(message.token);
        if (!decoded) return ws.close(4401, "Invalid token");

        try {
          const user = await User.findOne({ id: decoded.id })
            .select("id tokenVersion isDeleted")
            .lean();
          if (!user || user.isDeleted || (user.tokenVersion || 0) !== decoded.tv) {
            return ws.close(4401, "Session expired");
          }
        } catch {
          return ws.close(1011, "Server error");
        }

        clearTimeout(authTimer);
        state.userId = decoded.id;
        ws.send(JSON.stringify({ type: "AUTH_OK" }));
      });

      ws.on("close", () => {
        clearTimeout(authTimer);
        this.clientStates.delete(ws);
      });

      ws.on("pong", () => {
        state.isAlive = true;
      });
    });

    // Heartbeat interval
    this.heartbeat = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        const state = this.clientStates.get(ws);
        if (!state || state.isAlive === false) return ws.terminate();
        state.isAlive = false;
        ws.ping();
      });
    }, 30000);
  }

  /** Stops the heartbeat and closes every connection (graceful shutdown, tests) */
  close() {
    clearInterval(this.heartbeat);
    if (!this.wss) return;
    this.wss.clients.forEach((client) => client.terminate());
    this.wss.close();
    this.wss = null;
  }

  /**
   * Send a message to all authenticated clients
   * @param {string} type - Message type (e.g., 'ORDER_FILLED')
   * @param {Object} data - Payload
   */
  broadcast(type, data) {
    if (!this.wss) return;

    const message = JSON.stringify({ type, data });
    this.wss.clients.forEach((client) => {
      const state = this.clientStates.get(client);
      if (client.readyState === WebSocket.OPEN && state?.userId) {
        client.send(message);
      }
    });
  }

  /**
   * Send a message to a specific user's connections
   * @param {string} userId - User ID to target
   * @param {string} type - Message type
   * @param {Object} data - Payload
   */
  sendToUser(userId, type, data) {
    if (!this.wss) return;

    const message = JSON.stringify({ type, data });
    this.wss.clients.forEach((client) => {
      const state = this.clientStates.get(client);
      if (client.readyState === WebSocket.OPEN && state && state.userId === userId) {
        client.send(message);
      }
    });
  }
}

const socketService = new SocketService();
module.exports = socketService;
