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

const stringifyData = (data, silent) => {
  const out = {};
  if (data && typeof data === "object") {
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined || value === null) continue;
      out[String(key)] = String(value);
    }
  }
  if (silent) {
    out.silent = "true";
  }
  return out;
};

/**
 * Dispatch an FCM push notification to all native devices belonging to `userIds`
 * that have registered a push token. Never throws to callers.
 */
export const sendToUsers = async (
  models,
  userIds,
  { title = "", body = "", data = {}, silent = false } = {},
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
      },
    });

    if (!devices || devices.length === 0) {
      return { sent: 0, reached: 0 };
    }

    const stringData = stringifyData(data, silent);
    let sent = 0;

    for (const device of devices) {
      if (!device?.push_token) continue;
      try {
        await messaging.send({
          token: device.push_token,
          notification: {
            title: String(title || ""),
            body: String(body || ""),
          },
          data: stringData,
          android: {
            priority: silent ? "normal" : "high",
            notification: {
              channelId: "bills",
              ...(silent ? { defaultSound: false } : { sound: "default" }),
            },
          },
        });
        sent += 1;
      } catch (err) {
        const code = err?.code || err?.errorInfo?.code;
        if (INVALID_TOKEN_CODES.has(code)) {
          try {
            if (typeof device.update === "function") {
              await device.update({
                push_token: null,
                push_token_updated_at: new Date(),
              });
            } else if (models.OperatorDevice.update) {
              await models.OperatorDevice.update(
                { push_token: null, push_token_updated_at: new Date() },
                { where: { operator_device_id: device.operator_device_id } },
              );
            }
          } catch {
            // Best-effort token cleanup must never abort other device sends
          }
        }
      }
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
