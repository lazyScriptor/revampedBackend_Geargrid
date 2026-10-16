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

export const emitToUser = (userIdOrTenant, eventOrUserId, payloadOrEvent, maybePayload) => {
  // Scoped invocation: emitToUser(tenantDbName, userId, event, payload)
  if (maybePayload !== undefined) {
    const tenantDbName = userIdOrTenant;
    const userId = eventOrUserId;
    const event = payloadOrEvent;
    const payload = maybePayload;
    if (tenantDbName && userId != null) {
      safeEmit(`tenant:${tenantDbName}:user:${userId}`, event, payload);
    } else if (userId != null) {
      safeEmit(`user:${userId}`, event, payload);
    }
    return;
  }

  // Legacy fallback: emitToUser(userId, event, payload)
  const userId = userIdOrTenant;
  const event = eventOrUserId;
  const payload = payloadOrEvent;
  if (userId == null) return;
  safeEmit(`user:${userId}`, event, payload);
};

export const emitToTenant = (tenantDbName, event, payload) => {
  if (!tenantDbName) return;
  safeEmit(`tenant:${tenantDbName}`, event, payload);
};
