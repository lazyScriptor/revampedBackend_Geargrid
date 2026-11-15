import { beforeEach, describe, expect, it, vi } from "vitest";
import { Op } from "sequelize";

const mockCreateNotification = vi.fn().mockResolvedValue({});
const mockSendToUsers = vi.fn().mockResolvedValue({ sent: 1 });
const mockListAdminUserIds = vi.fn().mockResolvedValue([1, 2]);

vi.mock("../../src/services/notificationService.js", () => ({
  createNotification: (...args) => mockCreateNotification(...args),
}));

vi.mock("../../src/services/devicePushService.js", () => ({
  sendToUsers: (...args) => mockSendToUsers(...args),
}));

vi.mock("../../src/services/userService.js", () => ({
  listAdminUserIds: (...args) => mockListAdminUserIds(...args),
}));

const {
  syncDeviceContacts,
  searchPhoneContacts,
  usePhoneContact,
  formatPhoneLocal,
  splitDisplayName,
} = await import("../../src/services/phoneContactService.js");

describe("phone contact helpers", () => {
  it("formats Sri Lankan 94XXXXXXXXX digits as local 0XXXXXXXXX and preserves international", () => {
    expect(formatPhoneLocal("94771234567")).toBe("0771234567");
    expect(formatPhoneLocal("447911123456")).toBe("+447911123456");
  });

  it("splits display_name on the first space", () => {
    expect(splitDisplayName("Nimal Perera")).toEqual({ first_name: "Nimal", last_name: "Perera" });
    expect(splitDisplayName("Kamal Silva Fernando")).toEqual({
      first_name: "Kamal",
      last_name: "Silva Fernando",
    });
    expect(splitDisplayName("Saman")).toEqual({ first_name: "Saman", last_name: "" });
  });
});

describe("syncDeviceContacts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects with 409 when contact_sync_enabled is false", async () => {
    await expect(
      syncDeviceContacts(
        {},
        { operator_device_id: 1, contact_sync_enabled: false },
        { full: true, upserts: [], deletes: [] },
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("rejects batches larger than 500 upserts with 400", async () => {
    const upserts = Array.from({ length: 501 }, (_, i) => ({
      key: `k${i}`,
      name: `Person ${i}`,
      phones: ["0771234567"],
    }));
    await expect(
      syncDeviceContacts(
        {},
        { operator_device_id: 1, contact_sync_enabled: true },
        { full: false, upserts, deletes: [] },
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("normalizes numbers, links existing customers, skips invalid numbers, and handles deletes/full prune", async () => {
    const existingRow = {
      contact_id: 10,
      device_contact_key: "k1",
      phone_e164: "94771112222",
      update: vi.fn().mockResolvedValue({}),
    };
    const staleRow = {
      contact_id: 11,
      device_contact_key: "k1",
      phone_e164: "94779999999",
    };

    const models = {
      CustomerPhone: {
        findAll: vi.fn().mockResolvedValue([{ customer_id: 88, phone_e164: "94771112222" }]),
      },
      PhoneContact: {
        findAll: vi.fn().mockResolvedValue([existingRow, staleRow]),
        destroy: vi.fn().mockResolvedValue(1),
        bulkCreate: vi.fn().mockResolvedValue([]),
      },
      sequelize: {
        transaction: vi.fn(async (fn) => await fn({ id: "tx-sync" })),
      },
    };
    const device = {
      operator_device_id: 5,
      contact_sync_enabled: true,
      update: vi.fn().mockResolvedValue({}),
    };

    const res = await syncDeviceContacts(models, device, {
      full: true,
      final: true,
      upserts: [
        { key: "k1", name: "Nimal", phones: ["077 111 2222", "bad-phone"] },
        { key: "k2", name: "Sunil", phones: ["+94 71 222 3333"] },
      ],
      deletes: ["k-old"],
    });

    expect(res.accepted).toBe(2);
    expect(res.skipped).toBe(1);
    expect(existingRow.update).toHaveBeenCalledWith(
      {
        display_name: "Nimal",
        raw_phone: "077 111 2222",
        linked_customer_id: 88,
      },
      { transaction: { id: "tx-sync" } },
    );
    expect(models.PhoneContact.bulkCreate).toHaveBeenCalledWith(
      [
        {
          operator_device_id: 5,
          device_contact_key: "k2",
          display_name: "Sunil",
          phone_e164: "94712223333",
          raw_phone: "+94 71 222 3333",
          linked_customer_id: null,
        },
      ],
      { transaction: { id: "tx-sync" } },
    );
    // Destroy called for: stale phone [11], explicit deletes ["k-old"], full-sync prune notIn ["k1","k2"]
    expect(models.PhoneContact.destroy).toHaveBeenCalledWith({
      where: { contact_id: { [Op.in]: [11] } },
      transaction: { id: "tx-sync" },
    });
    expect(models.PhoneContact.destroy).toHaveBeenCalledWith({
      where: { operator_device_id: 5, device_contact_key: { [Op.in]: ["k-old"] } },
      transaction: { id: "tx-sync" },
    });
    expect(models.PhoneContact.destroy).toHaveBeenCalledWith({
      where: { operator_device_id: 5, device_contact_key: { [Op.notIn]: ["k1", "k2"] } },
      transaction: { id: "tx-sync" },
    });
    expect(device.update).toHaveBeenCalled();
  });

  it("skips full-sync pruning on intermediate chunks where final=false", async () => {
    const models = {
      CustomerPhone: { findAll: vi.fn().mockResolvedValue([]) },
      PhoneContact: {
        findAll: vi.fn().mockResolvedValue([]),
        destroy: vi.fn().mockResolvedValue(0),
        bulkCreate: vi.fn().mockResolvedValue([]),
      },
    };
    const device = { operator_device_id: 5, contact_sync_enabled: true, update: vi.fn() };

    await syncDeviceContacts(models, device, {
      full: true,
      final: false,
      upserts: [{ key: "k1", name: "Nimal", phones: ["0771234567"] }],
      deletes: [],
    });

    expect(models.PhoneContact.destroy).not.toHaveBeenCalled();
  });
});

describe("searchPhoneContacts & usePhoneContact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects search shorter than 3 characters", async () => {
    await expect(searchPhoneContacts({}, { search: "ab" })).rejects.toMatchObject({ statusCode: 400 });
  });

  it("returns unlinked contacts matching a full phone number, capped at 10", async () => {
    const models = {
      OperatorDevice: {},
      PhoneContact: {
        findAll: vi.fn().mockResolvedValue([
          {
            contact_id: 3,
            operator_device_id: 5,
            display_name: "Nimal Perera",
            phone_e164: "94771234567",
            raw_phone: "0771234567",
            OperatorDevice: { device_label: "Shop Samsung" },
          },
        ]),
      },
    };

    const res = await searchPhoneContacts(models, { search: "0771234567", limit: 25 });
    expect(models.PhoneContact.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10 }),
    );
    expect(res.contacts).toEqual([
      {
        contact_id: 3,
        operator_device_id: 5,
        device_label: "Shop Samsung",
        display_name: "Nimal Perera",
        phone_e164: "94771234567",
        raw_phone: "0771234567",
      },
    ]);
  });

  it("records last_used, splits name, formats local phone, and sends no owner alert", async () => {
    const contact = {
      contact_id: 9,
      display_name: "Nimal Perera",
      phone_e164: "94771234567",
      raw_phone: "+94771234567",
      update: vi.fn().mockResolvedValue({}),
    };
    const models = { PhoneContact: { findByPk: vi.fn().mockResolvedValue(contact) } };
    mockListAdminUserIds.mockResolvedValue([1, 2]);

    const res = await usePhoneContact(models, 9, { userId: 1 }, { phone: "0771234567" });
    await new Promise((r) => setTimeout(r, 15));

    expect(contact.update).toHaveBeenCalledWith(
      expect.objectContaining({ last_used_by_user_id: 1 }),
    );
    expect(res).toEqual({
      contact_id: 9,
      first_name: "Nimal",
      last_name: "Perera",
      phone_number: "0771234567",
    });
    // The "phone contact used" owner alert was removed at the shop owner's request.
    expect(mockCreateNotification).not.toHaveBeenCalled();
    expect(mockSendToUsers).not.toHaveBeenCalled();
  });
});
