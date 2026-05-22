import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { corsOrigins } from "../config/cors-config.js";

let ioInstance = null;

const parseCookieHeader = (rawCookieHeader) => {
  if (!rawCookieHeader) return {};
  return rawCookieHeader.split(";").reduce((acc, part) => {
    const idx = part.indexOf("=");
    if (idx === -1) return acc;
    const key = part.slice(0, idx).trim();
    const val = decodeURIComponent(part.slice(idx + 1).trim());
    acc[key] = val;
    return acc;
  }, {});
};

// Verify the JWT during the socket.io handshake.
// Accepts the token either via the Cookie header (matches HTTP auth) or via
// `auth.token` payload from the client — both are supported for flexibility.
const authenticateSocket = (socket, next) => {
  try {
    const cookies = parseCookieHeader(socket.handshake.headers?.cookie);
    const token =
      socket.handshake.auth?.token ||
      cookies.accessToken ||
      socket.handshake.query?.token;

    if (!token) {
      return next(new Error("Unauthorized: no access token on handshake"));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = decoded;
    next();
  } catch (err) {
    next(new Error("Unauthorized: invalid or expired token"));
  }
};

export const initSocketServer = (httpServer) => {
  ioInstance = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (corsOrigins.includes(origin)) return callback(null, true);
        return callback(new Error(`Socket CORS: origin "${origin}" not allowed`));
      },
      credentials: true,
    },
    // Heartbeat tuning — defaults are fine but slightly more lenient for long-running jobs.
    pingInterval: 25_000,
    pingTimeout: 60_000,
  });

  ioInstance.use(authenticateSocket);

  ioInstance.on("connection", (socket) => {
    const { userId, tenantDbName } = socket.user || {};

    if (userId) socket.join(`user:${userId}`);
    if (tenantDbName) socket.join(`tenant:${tenantDbName}`);

    // eslint-disable-next-line no-console
    console.log(
      `🔌 socket connected user=${userId} tenant=${tenantDbName} id=${socket.id}`,
    );

    socket.on("disconnect", (reason) => {
      // eslint-disable-next-line no-console
      console.log(`🔌 socket disconnected user=${userId} reason=${reason}`);
    });
  });

  return ioInstance;
};

export const getIo = () => {
  if (!ioInstance) {
    throw new Error("socket.io not initialized — call initSocketServer first");
  }
  return ioInstance;
};
