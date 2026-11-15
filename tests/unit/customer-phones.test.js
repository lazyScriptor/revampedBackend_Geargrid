import { describe, expect, it, vi } from "vitest";
import { normalizePhone, splitPhones } from "../../src/utils/whatsappPhone.js";
import {
  extractCustomerPhoneEntries,
  syncCustomerPhones,
  findCustomerIdsByPhone,
} from "../../src/services/customerPhoneService.js";
import {
  createCustomer,
  updateCustomer,
  deleteCustomer,
} from "../../src/services/customerService.js";

describe("splitPhones and Sri Lankan phone normalization", () => {
  it("normalizes all local and international variants of the same mobile number to digits-only 94XXXXXXXXX", () => {
    const variants = [
      "0771234567",
      "+94 77 123 4567",
      "94771234567",
      "0094771234567",
      "771234567",
      "+94 (0) 77 123 4567",
    ];
    for (const raw of variants) {
      const res = normalizePhone(raw);
      expect(res.digits).toBe("94771234567");
      expect(res.kind).toBe("mobile");
      expect(res.valid).toBe(true);
    }
  });

  it("splits multi-number fields, keeps landlines, deduplicates equivalent numbers, and drops junk", () => {
    expect(splitPhones("011 2345678 / 0771234567; +94 77 123 4567, none")).toEqual([
      "011 2345678",
      "0771234567",
      "+94 77 123 4567",
      "none",
    ]);

    const entries = extractCustomerPhoneEntries(
      "011 2345678 / 0771234567; +94 77 123 4567, 0719876543, none",
    );
    expect(entries).toEqual([
      { phone_e164: "94112345678", is_primary: false },
      { phone_e164: "94771234567", is_primary: true },
      { phone_e164: "94719876543", is_primary: false },
    ]);
  });

  it("rejects junk strings without digits", () => {
    expect(extractCustomerPhoneEntries("no phone / --- / abc")).toEqual([]);
    expect(extractCustomerPhoneEntries(null)).toEqual([]);
  });
});

describe("syncCustomerPhones", () => {
  it("destroys existing rows and inserts normalized numbers inside the given transaction", async () => {
    const destroy = vi.fn().mockResolvedValue(1);
    const bulkCreate = vi.fn().mockResolvedValue([]);
    const models = { CustomerPhone: { destroy, bulkCreate } };
    const tx = { id: "tx-1" };

    const rows = await syncCustomerPhones(
      models,
      {
        customer_id: 42,
        phone_number: "011-2691111 / 077 555 1234",
        customer_delete_status: false,
      },
      { transaction: tx },
    );

    expect(destroy).toHaveBeenCalledWith({
      where: { customer_id: 42 },
      transaction: tx,
    });
    expect(bulkCreate).toHaveBeenCalledWith(
      [
        { customer_id: 42, phone_e164: "94112691111", is_primary: false },
        { customer_id: 42, phone_e164: "94775551234", is_primary: true },
      ],
      { transaction: tx },
    );
    expect(rows).toHaveLength(2);
  });

  it("clears indexed phones when the customer is soft-deleted", async () => {
    const destroy = vi.fn().mockResolvedValue(2);
    const bulkCreate = vi.fn();
    const models = { CustomerPhone: { destroy, bulkCreate } };

    const rows = await syncCustomerPhones(models, {
      customer_id: 42,
      phone_number: "0775551234",
      customer_delete_status: true,
    });

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(bulkCreate).not.toHaveBeenCalled();
    expect(rows).toEqual([]);
  });
});

describe("findCustomerIdsByPhone", () => {
  it("normalizes caller variants before querying CUSTOMER_PHONES and deduplicates IDs", async () => {
    const findAll = vi.fn().mockResolvedValue([
      { customer_id: 7 },
      { customer_id: 19 },
      { customer_id: 7 },
    ]);
    const models = { CustomerPhone: { findAll } };

    const ids = await findCustomerIdsByPhone(models, "+94 77 123 4567");
    expect(findAll).toHaveBeenCalledWith({
      where: { phone_e164: "94771234567" },
      attributes: ["customer_id"],
      raw: true,
    });
    expect(ids).toEqual([7, 19]);
  });

  it("returns [] cleanly for unparseable numbers without hitting the DB", async () => {
    const findAll = vi.fn();
    const ids = await findCustomerIdsByPhone({ CustomerPhone: { findAll } }, "unknown");
    expect(ids).toEqual([]);
    expect(findAll).not.toHaveBeenCalled();
  });
});

describe("customerService phone sync hooks", () => {
  const makeTxModels = (customerRow) => {
    const fakeTx = { id: "tx-cust" };
    return {
      fakeTx,
      Customer: {
        findOne: vi.fn().mockResolvedValue(null),
        findByPk: vi.fn().mockResolvedValue(customerRow),
        create: vi.fn().mockResolvedValue(customerRow),
      },
      CustomerPhone: {
        destroy: vi.fn().mockResolvedValue(0),
        bulkCreate: vi.fn().mockResolvedValue([]),
      },
      Invoice: { count: vi.fn().mockResolvedValue(0) },
      sequelize: {
        transaction: vi.fn(async (cb) => await cb(fakeTx)),
      },
    };
  };

  it("syncs phones inside transaction on createCustomer", async () => {
    const customerRow = {
      customer_id: 99,
      phone_number: "0771234567",
      customer_delete_status: false,
    };
    const models = makeTxModels(customerRow);

    await createCustomer(models, {
      first_name: "Kamal",
      phone_number: "0771234567",
    });

    expect(models.Customer.create).toHaveBeenCalledWith(
      expect.objectContaining({ first_name: "Kamal" }),
      { transaction: models.fakeTx },
    );
    expect(models.CustomerPhone.bulkCreate).toHaveBeenCalledWith(
      [{ customer_id: 99, phone_e164: "94771234567", is_primary: true }],
      { transaction: models.fakeTx },
    );
  });

  it("syncs phones inside transaction on updateCustomer when phone_number changes", async () => {
    const customerRow = {
      customer_id: 99,
      nic_number: "123456789V",
      phone_number: "0771234567",
      customer_delete_status: false,
      update: vi.fn().mockImplementation(function (patch) {
        Object.assign(this, patch);
        return Promise.resolve(this);
      }),
    };
    const models = makeTxModels(customerRow);
    // updateData omits nic_number so updateCustomer skips NIC uniqueness check;
    // the first findOne call is inside getCustomerById(models, 99).
    models.Customer.findByPk.mockResolvedValue(customerRow);
    models.Customer.findOne.mockResolvedValue(customerRow);

    await updateCustomer(models, 99, { phone_number: "0712223344" });

    expect(models.CustomerPhone.destroy).toHaveBeenCalledWith({
      where: { customer_id: 99 },
      transaction: models.fakeTx,
    });
    expect(models.CustomerPhone.bulkCreate).toHaveBeenCalledWith(
      [{ customer_id: 99, phone_e164: "94712223344", is_primary: true }],
      { transaction: models.fakeTx },
    );
  });

  it("clears indexed phones on deleteCustomer", async () => {
    const customerRow = {
      customer_id: 99,
      phone_number: "0771234567",
      customer_delete_status: false,
      is_id_retained_currently: false,
      update: vi.fn().mockImplementation(function (patch) {
        Object.assign(this, patch);
        return Promise.resolve(this);
      }),
    };
    const models = makeTxModels(customerRow);

    await deleteCustomer(models, 99);

    expect(models.CustomerPhone.destroy).toHaveBeenCalledWith({
      where: { customer_id: 99 },
      transaction: models.fakeTx,
    });
    expect(models.CustomerPhone.bulkCreate).not.toHaveBeenCalled();
  });
});
