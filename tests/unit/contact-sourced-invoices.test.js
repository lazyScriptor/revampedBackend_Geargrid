import { describe, expect, it, vi } from "vitest";
import { Op } from "sequelize";
import { createCustomer } from "../../src/services/customerService.js";
import { createDispatchInvoice } from "../../src/services/invoiceService.js";

describe("contact-sourced customers (A6)", () => {
  it("stores source_contact_id on customer create and links PHONE_CONTACTS matching its numbers", async () => {
    const tx = { id: "tx-cust-link" };
    const createdCustomer = {
      customer_id: 25,
      phone_number: "0771234567",
      source_contact_id: 9,
      customer_delete_status: false,
    };
    const models = {
      Customer: {
        findOne: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(createdCustomer),
      },
      CustomerPhone: {
        destroy: vi.fn().mockResolvedValue(0),
        bulkCreate: vi.fn().mockResolvedValue([]),
      },
      PhoneContact: {
        findByPk: vi.fn().mockResolvedValue({
          contact_id: 9,
          operator_device_id: 3,
          device_contact_key: "key-9",
          phone_e164: "94771234567",
        }),
        update: vi.fn().mockResolvedValue([2]),
      },
      sequelize: {
        transaction: vi.fn(async (fn) => await fn(tx)),
      },
    };

    const res = await createCustomer(models, {
      first_name: "Nimal",
      phone_number: "0771234567",
      source_contact_id: 9,
    });

    expect(res.source_contact_id).toBe(9);
    expect(models.Customer.create).toHaveBeenCalledWith(
      expect.objectContaining({ source_contact_id: 9 }),
      { transaction: tx },
    );
    expect(models.PhoneContact.update).toHaveBeenCalledWith(
      { linked_customer_id: 25 },
      expect.objectContaining({
        transaction: tx,
        where: {
          [Op.or]: expect.arrayContaining([
            { contact_id: 9 },
            { phone_e164: { [Op.in]: ["94771234567"] } },
          ]),
        },
      }),
    );
  });

  it("never tags a bill with source_contact_id, even a contact-sourced customer's first bill", async () => {
    const buildModels = (priorInvoiceCount) => {
      const tx = { LOCK: { UPDATE: "UPDATE" } };
      const eq = {
        equipment_id: 1,
        equipment_name: "Mixer",
        available_qty: 5,
        rented_qty: 0,
        update: vi.fn().mockResolvedValue({}),
      };
      const models = {
        Customer: {
          findByPk: vi.fn().mockResolvedValue({ customer_id: 25, source_contact_id: 9 }),
        },
        Invoice: {
          count: vi.fn().mockResolvedValue(priorInvoiceCount),
          findAll: vi.fn().mockResolvedValue([]),
          create: vi.fn().mockImplementation(async (data) => ({ invoice_id: 100, ...data })),
        },
        InvoiceLine: {
          bulkCreate: vi.fn().mockResolvedValue([]),
          findAll: vi.fn().mockResolvedValue([]),
        },
        Equipment: {
          findByPk: vi.fn().mockResolvedValue(eq),
        },
        Payment: { create: vi.fn().mockResolvedValue({}) },
        InvoiceTrace: { create: vi.fn().mockResolvedValue({}) },
        sequelize: { transaction: vi.fn(async (fn) => await fn(tx)) },
      };
      models.Invoice.unscoped = () => ({ count: models.Invoice.count });
      return models;
    };

    const payload = {
      customer_id: 25,
      source_contact_id: 999, // untrusted client override must be ignored
      items: [
        {
          equipment_id: 1,
          borrow_date: "2026-11-15",
          expected_return_date: "2026-11-16",
          locked_base_price: 1000,
          locked_minimum_days: 1,
          locked_extra_daily_rate: 1000,
          borrow_quantity: 1,
        },
      ],
      fees: { transport: 0, discount: 0, advance: 0 },
    };

    // The "From contacts" tab was removed, so bills are no longer tagged at all.
    const models = buildModels(0);
    await createDispatchInvoice(models, payload, 1);
    expect(models.Invoice.create.mock.calls[0][0].source_contact_id).toBeUndefined();
  });
});
