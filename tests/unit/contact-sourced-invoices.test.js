import { describe, expect, it, vi } from "vitest";
import { Op } from "sequelize";
import { createCustomer } from "../../src/services/customerService.js";
import {
  createDispatchInvoice,
  getAllInvoices,
  reviewContactInvoice,
} from "../../src/services/invoiceService.js";

describe("contact-sourced customer & invoice lineage (A6)", () => {
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

  it("derives INVOICES.source_contact_id on the customer's first bill only and ignores client override", async () => {
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

    // First bill -> copies customer.source_contact_id = 9 (never client 999)
    const firstModels = buildModels(0);
    await createDispatchInvoice(firstModels, payload, 1);
    expect(firstModels.Invoice.create).toHaveBeenCalledWith(
      expect.objectContaining({ source_contact_id: 9 }),
      expect.anything(),
    );

    // Second bill -> no source_contact_id copied
    const secondModels = buildModels(1);
    await createDispatchInvoice(secondModels, payload, 1);
    const secondArg = secondModels.Invoice.create.mock.calls[0][0];
    expect(secondArg.source_contact_id).toBeUndefined();
  });

  it("filters getAllInvoices by contact_sourced=true while keeping distinct: true", async () => {
    const models = {
      Invoice: {
        count: vi.fn().mockResolvedValue(3),
        findAndCountAll: vi.fn().mockResolvedValue({ count: 3, rows: [] }),
      },
      Customer: {},
      InvoiceLine: {},
      Equipment: {},
      Payment: {},
      InvoiceTrace: {},
      User: {},
    };

    const res = await getAllInvoices(models, { contact_sourced: "true" });
    expect(models.Invoice.findAndCountAll).toHaveBeenCalledWith(
      expect.objectContaining({
        distinct: true,
        col: "invoice_id",
        where: expect.objectContaining({ source_contact_id: { [Op.ne]: null } }),
      }),
    );
    expect(res.counts.from_contacts).toBe(3);
  });

  it("marks contact-sourced invoices reviewed and rejects regular invoices with 400", async () => {
    const regularInvoice = { invoice_id: 10, source_contact_id: null };
    const contactInvoice = {
      invoice_id: 11,
      source_contact_id: 9,
      update: vi.fn().mockResolvedValue({}),
    };
    const models = {
      Invoice: {
        findByPk: vi.fn().mockImplementation(async (id) =>
          id === 10 ? regularInvoice : contactInvoice,
        ),
      },
      User: {
        findByPk: vi.fn().mockResolvedValue({
          user_id: 1,
          first_name: "Owner",
          last_name: "Admin",
        }),
      },
    };

    await expect(reviewContactInvoice(models, 10, 1)).rejects.toMatchObject({ statusCode: 400 });

    const reviewed = await reviewContactInvoice(models, 11, 1);
    expect(contactInvoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        contact_reviewed_by: 1,
        contact_reviewed_at: expect.any(Date),
      }),
    );
    expect(reviewed.reviewer_name).toBe("Owner Admin");
    expect(reviewed.contact_reviewed_by).toBe(1);
  });
});
