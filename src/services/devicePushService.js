import { Op } from "sequelize";

// Safe FCM push dispatcher (Release 1 Slice B).
// Reads FIREBASE_SERVICE_ACCOUNT_JSON on demand; never prints or logs secret contents.
// When unconfigured, logs once and treats sends as no-ops so local dev and tests run without Firebase.

let missingLogged = false;
let initErrorLogged = false;
let messagingInstance = null;
let testMessagingClient = null;

const INVALID_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

/** Log once when FIREBASE_SERVICE_ACCOUNT_JSON is missing so ops sees why FCM is disabled. */
export const warnIfFirebaseUnconfigured = () => {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON && !missingLogged) {
    missingLogged = true;
    console.warn(
      "⚠️ [devicePushService] FIREBASE_SERVICE_ACCOUNT_JSON is not set; FCM push notifications are disabled.",
    );
    return true;
  }
  return false;
};

const getMessagingClient = async () => {
  if (testMessagingClient) return testMessagingClient;
  if (messagingInstance) return messagingInstance;

  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!rawJson) {
    warnIfFirebaseUnconfigured();
    return null;
  }

  try {
    const serviceAccount = JSON.parse(rawJson);
    const [{ cert, getApp, getApps, initializeApp }, { getMessaging }] =
      await Promise.all([
        import("firebase-admin/app"),
        import("firebase-admin/messaging"),
      ]);
    const app =
      getApps().length === 0
        ? initializeApp({ credential: cert(serviceAccount) })
        : getApp();
    messagingInstance = getMessaging(app);
    return messagingInstance;
  } catch (err) {
    if (!initErrorLogged) {
      initErrorLogged = true;
      console.warn(
        "[devicePushService] Failed to initialize Firebase messaging:",
        err?.message || "unknown error",
      );
    }
    return null;
  }
};

const stringifyData = (data, { title = "", body = "", channel = null, silent = false } = {}) => {
  const out = {};
  if (data && typeof data === "object") {
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined || value === null) continue;
      out[String(key)] = String(value);
    }
  }
  if (title !== undefined && title !== null && String(title) !== "") {
    out.title = String(title);
  }
  if (body !== undefined && body !== null && String(body) !== "") {
    out.body = String(body);
  }
  if (channel) {
    out.channel = String(channel);
  }
  if (silent) {
    out.silent = "true";
  }
  return out;
};

/**
 * Send a data-only FCM message to one paired device (A-08).
 * Omitting top-level `notification` guarantees Android delivers every payload
 * through `GearGridMessagingService.onMessageReceived` even when backgrounded.
 */
export const sendPushToDevice = async (
  models,
  device,
  { title = "", body = "", data = {}, silent = false, channel = null } = {},
) => {
  if (!device?.push_token) return { sent: false, reason: "no_token" };
  const messaging = await getMessagingClient();
  if (!messaging) return { sent: false, reason: "unconfigured" };

  const resolvedChannel = channel || (silent ? "bills_silent" : "bills");
  const stringData = stringifyData(data, {
    title,
    body,
    channel: resolvedChannel,
    silent,
  });

  try {
    await messaging.send({
      token: device.push_token,
      data: stringData,
      android: {
        priority: silent ? "normal" : "high",
      },
    });
    return { sent: true };
  } catch (err) {
    const code = err?.code || err?.errorInfo?.code;
    if (INVALID_TOKEN_CODES.has(code)) {
      try {
        if (typeof device.update === "function") {
          await device.update({
            push_token: null,
            push_token_updated_at: new Date(),
          });
        } else if (models?.OperatorDevice?.update) {
          await models.OperatorDevice.update(
            { push_token: null, push_token_updated_at: new Date() },
            { where: { operator_device_id: device.operator_device_id } },
          );
        }
      } catch {
        // Best-effort token cleanup must never abort other device sends
      }
    }
    return { sent: false, reason: code || "send_failed" };
  }
};

/**
 * Send a silent control data message (e.g. device_revoked, wipe_cache) to a device.
 */
export const sendDataPush = async (device, data = {}, { priority = "high" } = {}) => {
  if (!device?.push_token) return { sent: false, reason: "no_token" };
  const messaging = await getMessagingClient();
  if (!messaging) return { sent: false, reason: "unconfigured" };

  const stringData = stringifyData(data);
  try {
    await messaging.send({
      token: device.push_token,
      data: stringData,
      android: { priority },
    });
    return { sent: true };
  } catch {
    return { sent: false, reason: "send_failed" };
  }
};

/**
 * Dispatch a data-only FCM notification to all native devices belonging to `userIds`
 * that have registered a push token. Never throws to callers.
 */
export const sendToUsers = async (
  models,
  userIds,
  { title = "", body = "", data = {}, silent = false, channel = null, render = null } = {},
) => {
  try {
    const cleanUserIds = [
      ...new Set(
        (Array.isArray(userIds) ? userIds : [])
          .map((id) => Number(id))
          .filter((id) => Number.isFinite(id) && id > 0),
      ),
    ];

    if (cleanUserIds.length === 0) {
      return { sent: 0, reached: 0 };
    }

    const messaging = await getMessagingClient();
    if (!messaging) {
      return { sent: 0, reached: 0, skipped: true };
    }

    if (!models?.OperatorDevice?.findAll) {
      return { sent: 0, reached: 0 };
    }

    const devices = await models.OperatorDevice.findAll({
      where: {
        user_id: { [Op.in]: cleanUserIds },
        is_native_app: true,
        push_token: { [Op.ne]: null },
        status: "ACTIVE",
        muted: false,
      },
    });

    if (!devices || devices.length === 0) {
      return { sent: 0, reached: 0 };
    }

    let sent = 0;
    for (const device of devices) {
      if (device.muted === true) continue;
      if (device.status && device.status !== "ACTIVE") continue;
      // `render(device)` lets the caller word the message per phone (language, privacy).
      let text = { title, body };
      if (typeof render === "function") {
        try {
          text = (await render(device)) || text;
        } catch {
          text = { title, body };
        }
      }
      const res = await sendPushToDevice(models, device, {
        title: text.title,
        body: text.body,
        data,
        silent,
        channel,
      });
      if (res.sent) sent += 1;
    }

    return { sent, reached: sent };
  } catch {
    return { sent: 0, reached: 0 };
  }
};

export const __setMessagingForTests = (client) => {
  testMessagingClient = client;
};

export const __resetDevicePushForTests = () => {
  testMessagingClient = null;
  messagingInstance = null;
  missingLogged = false;
  initErrorLogged = false;
};

export const _resetMissingLogForTest = () => {
  missingLogged = false;
};
