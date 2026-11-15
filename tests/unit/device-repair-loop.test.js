import { describe, it, expect, vi, beforeEach } from "vitest";

const pushMock = vi.hoisted(() => ({ sendDataPush: vi.fn(async () => ({ sent: true })) }));
vi.mock("../../src/services/devicePushService.js", async (importOriginal) => ({
  ...(await importOriginal()),
  sendDataPush: pushMock.sendDataPush,
}));

const { unpairDevice } = await import("../../src/services/deviceService.js");
const { deviceAuth } = await import("../../src/middlewares/deviceAuth.js");

// A phone re-paired under a new device id keeps its push token. Unpairing the old id must not send
// "device_revoked" to that token, or the phone wipes its new pairing and loops back to pairing.
const tenantModelsWith = ({ otherLivePairing }) => {
  const oldRow = {
    operator_device_id: 6,
    device_id: "gg-old-pairing",
    user_id: 1,
    status: "ACTIVE",
    push_token: "fcm-same-phone",
    update: vi.fn(async () => {}),
  };
  return {
    oldRow,
    OperatorDevice: {
      findOne: vi.fn(async ({ where }) => {
        if (where.operator_device_id === 6) return oldRow;
        if (where.push_token) return otherLivePairing ? { operator_device_id: 7 } : null;
        return null;
      }),
    },
    PhoneContact: { destroy: vi.fn(async () => 0) },
    DeviceAuditLog: { create: vi.fn(async () => ({})) },
  };
};

beforeEach(() => pushMock.sendDataPush.mockClear());

describe("unpairing an old pairing of a re-paired phone", () => {
  it("does not push device_revoked when the token now belongs to a live pairing", async () => {
    const models = tenantModelsWith({ otherLivePairing: true });
    await unpairDevice(models, 6, 1, null);
    expect(models.oldRow.update).toHaveBeenCalledWith(expect.objectContaining({ status: "REVOKED" }));
    expect(pushMock.sendDataPush).not.toHaveBeenCalled();
  });

  it("still pushes device_revoked, naming the device, when no other pairing uses the token", async () => {
    const models = tenantModelsWith({ otherLivePairing: false });
    await unpairDevice(models, 6, 1, null);
    expect(pushMock.sendDataPush).toHaveBeenCalledWith(
      { push_token: "fcm-same-phone", device_id: "gg-old-pairing" },
      { type: "device_revoked" },
    );
  });
});

describe("deviceAuth on a server fault", () => {
  it("answers 500, not 401, so the phone does not wipe its pairing", async () => {
    const req = {
      method: "GET",
      originalUrl: "/api/device/follow-ups",
      path: "/follow-ups",
      // Throws inside the check, like a database error would.
      headers: new Proxy(
        { "x-device-id": "gg-x", "x-tenant-db": "geargrid_x", authorization: "Bearer t" },
        { get: (t, k) => { if (k === "x-tenant-db") throw new Error("db down"); return t[k]; } },
      ),
    };
    const next = vi.fn();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await deviceAuth(req, {}, next);
    err.mockRestore();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 500 }));
  });
});
