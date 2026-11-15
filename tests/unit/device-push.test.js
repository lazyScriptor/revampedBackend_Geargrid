import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  sendToUsers,
  warnIfFirebaseUnconfigured,
  __setMessagingForTests,
  __resetDevicePushForTests,
} from "../../src/services/devicePushService.js";

describe("devicePushService", () => {
  const originalEnv = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  beforeEach(() => {
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    __resetDevicePushForTests();
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON = originalEnv;
    } else {
      delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    }
    __resetDevicePushForTests();
    vi.restoreAllMocks();
  });

  it("imports firebase-admin/app and firebase-admin/messaging modules", async () => {
    const [appMod, msgMod] = await Promise.all([
      import("firebase-admin/app"),
      import("firebase-admin/messaging"),
    ]);
    expect(typeof appMod.initializeApp).toBe("function");
    expect(typeof appMod.cert).toBe("function");
    expect(typeof appMod.getApps).toBe("function");
    expect(typeof msgMod.getMessaging).toBe("function");
  });

  it("treats missing FIREBASE_SERVICE_ACCOUNT_JSON as a safe no-op and logs one clear warning", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const models = {
      OperatorDevice: { findAll: vi.fn() },
    };

    expect(warnIfFirebaseUnconfigured()).toBe(true);
    expect(warnIfFirebaseUnconfigured()).toBe(false);

    const first = await sendToUsers(models, [1], { title: "Hi", body: "Test" });
    const second = await sendToUsers(models, [2], { title: "Hi", body: "Test" });

    expect(first).toEqual({ sent: 0, reached: 0, skipped: true });
    expect(second).toEqual({ sent: 0, reached: 0, skipped: true });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("FIREBASE_SERVICE_ACCOUNT_JSON");
    expect(models.OperatorDevice.findAll).not.toHaveBeenCalled();

    __resetDevicePushForTests();
    await sendToUsers(models, [1], { title: "Hi", body: "Test" });
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it("sends high-priority pushes on the 'bills' Android channel with stringified data", async () => {
    const sendMock = vi.fn().mockResolvedValue("msg-id-1");
    __setMessagingForTests({ send: sendMock });

    const models = {
      OperatorDevice: {
        findAll: vi.fn().mockResolvedValue([
          { operator_device_id: 11, user_id: 1, push_token: "fcm-token-1" },
          { operator_device_id: 12, user_id: 2, push_token: "fcm-token-2" },
        ]),
      },
    };

    const res = await sendToUsers(models, [1, 2, 1], {
      title: "New bill #42 · LKR 5,000",
      body: "Nimal · 2 item(s) · by Kasun",
      data: { type: "invoice_created", invoice_id: 42 },
    });

    expect(res).toEqual({ sent: 2, reached: 2 });
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(sendMock).toHaveBeenNthCalledWith(1, {
      token: "fcm-token-1",
      notification: {
        title: "New bill #42 · LKR 5,000",
        body: "Nimal · 2 item(s) · by Kasun",
      },
      data: { type: "invoice_created", invoice_id: "42" },
      android: {
        priority: "high",
        notification: { channelId: "bills", sound: "default" },
      },
    });
  });

  it("downgrades priority and omits sound when silent is true (quiet hours)", async () => {
    const sendMock = vi.fn().mockResolvedValue("msg-quiet");
    __setMessagingForTests({ send: sendMock });

    const models = {
      OperatorDevice: {
        findAll: vi.fn().mockResolvedValue([
          { operator_device_id: 11, user_id: 1, push_token: "fcm-token-1" },
        ]),
      },
    };

    const res = await sendToUsers(models, [1], {
      title: "Payment received",
      body: "LKR 2,000",
      data: { type: "payment_received", invoice_id: 12 },
      silent: true,
    });

    expect(res).toEqual({ sent: 1, reached: 1 });
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { type: "payment_received", invoice_id: "12", silent: "true" },
        android: {
          priority: "normal",
          notification: { channelId: "bills", defaultSound: false },
        },
      }),
    );
  });

  it("clears push_token when FCM reports registration-token-not-registered and never throws", async () => {
    const badErr = Object.assign(new Error("Unregistered"), {
      code: "messaging/registration-token-not-registered",
    });
    const sendMock = vi
      .fn()
      .mockRejectedValueOnce(badErr)
      .mockResolvedValueOnce("ok-2");
    __setMessagingForTests({ send: sendMock });

    const staleDevice = {
      operator_device_id: 21,
      user_id: 1,
      push_token: "dead-token",
      update: vi.fn().mockResolvedValue({}),
    };
    const healthyDevice = {
      operator_device_id: 22,
      user_id: 1,
      push_token: "good-token",
      update: vi.fn().mockResolvedValue({}),
    };

    const models = {
      OperatorDevice: {
        findAll: vi.fn().mockResolvedValue([staleDevice, healthyDevice]),
      },
    };

    const res = await sendToUsers(models, [1], { title: "Test", body: "Hello" });

    expect(res).toEqual({ sent: 1, reached: 1 });
    expect(staleDevice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        push_token: null,
        push_token_updated_at: expect.any(Date),
      }),
    );
    expect(healthyDevice.update).not.toHaveBeenCalled();
  });
});
