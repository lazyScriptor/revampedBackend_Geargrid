import { describe, it, expect, vi } from "vitest";
import { getCustomerInvoices } from "../../src/services/customerService.js";
import { toggleVaultStatus, getAllInvoices } from "../../src/services/invoiceService.js";

describe("Customer Invoices, Live Counts & Vault Toggle Unit Tests", () => {
  it("getCustomerInvoices aggregates stats (total, active, completed) correctly", async () => {
    const mockInvoices = [
      { invoice_id: 1, customer_id: 10, status: "Active", total_amount: 5000 },
      { invoice_id: 2, customer_id: 10, status: "Active", total_amount: 3000 },
      { invoice_id: 3, customer_id: 10, status: "Completed", total_amount: 8000 },
      { invoice_id: 4, customer_id: 10, status: "Completed", total_amount: 2500 },
    ];

    const mockModels = {
      Invoice: {
        findAll: vi.fn().mockResolvedValue(mockInvoices),
      },
      InvoiceLine: {},
      Equipment: {},
      Payment: {},
      Customer: {},
      InvoiceTrace: {},
    };

    const result = await getCustomerInvoices(mockModels, 10);

    expect(result.invoices).toHaveLength(4);
    expect(result.stats.total).toBe(4);
    expect(result.stats.active).toBe(2);
    expect(result.stats.completed).toBe(2);
  });

  it("getAllInvoices executes status count queries and returns counts summary", async () => {
    const mockModels = {
      Invoice: {
        count: vi.fn()
          .mockResolvedValueOnce(59) // all
          .mockResolvedValueOnce(19) // active
          .mockResolvedValueOnce(40), // completed
        findAndCountAll: vi.fn().mockResolvedValue({
          count: 59,
          rows: [{ invoice_id: 101, status: "Active" }],
        }),
      },
      Customer: {},
      InvoiceLine: {},
      Equipment: {},
      Payment: {},
      InvoiceTrace: {},
    };

    const result = await getAllInvoices(mockModels, { page: 1, limit: 25 });

    expect(result.totalItems).toBe(59);
    expect(result.counts).toEqual({
      all: 59,
      active: 19,
      completed: 40,
    });
  });

  it("toggleVaultStatus flips status and creates audit trace in transaction", async () => {
    const mockCustomer = {
      is_id_retained_currently: false,
      update: vi.fn().mockImplementation((fields) => {
        Object.assign(mockCustomer, fields);
        return Promise.resolve(mockCustomer);
      }),
    };

    const mockInvoice = {
      invoice_id: 42,
      id_card_status: 0,
      Customer: mockCustomer,
      update: vi.fn().mockImplementation((fields) => {
        Object.assign(mockInvoice, fields);
        return Promise.resolve(mockInvoice);
      }),
    };

    const mockModels = {
      Invoice: {
        findByPk: vi.fn().mockResolvedValue(mockInvoice),
      },
      InvoiceTrace: {
        create: vi.fn().mockResolvedValue({ trace_id: 1 }),
      },
      sequelize: {
        transaction: vi.fn().mockImplementation(async (callback) => {
          return await callback({});
        }),
      },
    };

    const result = await toggleVaultStatus(mockModels, 42, 99);

    expect(result.is_id_retained_currently).toBe(true);
    expect(result.id_card_status).toBe(1);
    expect(mockCustomer.update).toHaveBeenCalledWith(
      { is_id_retained_currently: true },
      { transaction: expect.anything() }
    );
    expect(mockInvoice.update).toHaveBeenCalledWith(
      { id_card_status: 1 },
      { transaction: expect.anything() }
    );
    expect(mockModels.InvoiceTrace.create).toHaveBeenCalledWith(
      expect.objectContaining({
        invoice_id: 42,
        event_category: "SECURITY",
        event_action: "ID_RETAINED",
      }),
      { transaction: expect.anything() }
    );
  });
});
