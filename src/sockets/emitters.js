import { getIo } from "./index.js";

// Best-effort emit — if the socket layer hasn't initialized yet (early boot)
// we swallow the error so persistence-then-emit ordering in services stays simple.
const safeEmit = (room, event, payload) => {
  try {
    const io = getIo();
    io.to(room).emit(event, payload);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`socket emit dropped (${event} → ${room}):`, err.message);
  }
};

export const emitToUser = (userId, event, payload) => {
  if (userId == null) return;
  safeEmit(`user:${userId}`, event, payload);
};

export const emitToTenant = (tenantDbName, event, payload) => {
  if (!tenantDbName) return;
  safeEmit(`tenant:${tenantDbName}`, event, payload);
};
