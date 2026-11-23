import crypto from "node:crypto";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { Op } from "sequelize";
import { createDispatchInvoice } from "../../src/services/invoiceService.js";
import { deleteInvoice } from "../../src/services/invoiceDeletionService.js";
import {
  checkStockIntegrity,
  createAndLinkUnlistedSaleLines,
  getApprovalDesk,
  hashContext,
  linkUnlistedSaleLines,
  markUnlistedOneOff,
  sha256Hex,
  updateRetailSettings,
} from "../../src/modules/retail/index.js";
import { idempotency } from "../../src/middlewares/idempotency.js";

const makeRecord = (data, pkField) => {
  const rec = { ...data };
  rec.update = vi.fn(async (patch) => {
    Object.assign(rec, patch);
    return rec;
  });
  rec.destroy = vi.fn(async () => {
    rec._destroyed = true;
  });
  rec.get = () => rec.toJSON();
  rec.toJSON = () => {
    const out = {};
    for (const [k, v] of Object.entries(rec)) {
      if (typeof v !== "function" && !k.startsWith("_")) out[k] = v;
    }
    return out;
  };
  if (pkField && rec[pkField] === undefined) rec[pkField] = 1;
  return rec;
};

const matchesWhere = (row, where = {}) => {
  for (const [k, v] of Object.entries(where)) {
    if (k === String(Op.or) || k === String(Op.and)) continue;
    if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
      if (Op.in in v && !v[Op.in].includes(row[k])) return false;
      if (Op.ne in v && row[k] === v[Op.ne]) return false;
      if (Op.gt in v && !(new Date(row[k]) > new Date(v[Op.gt]))) return false;
      if (Op.gte in v && !(Number(row[k]) >= Number(v[Op.gte]))) return false;
      continue;
    }
    if (v === null) {
      if (row[k] !== null && row[k] !== undefined) return false;
    } else if (row[k] !== v) {
      return false;
    }
  }
  return true;
};

const makeSalesHarness = ({
  products = [],
  units = [],
  levels = [],
  serials = [],
  customers = [],
  retailSettings = {},
  warehouses = [{ warehouse_id: 1, location_name: "Main", is_default: true }],
  categories = [{ category_id: 1, name: "General", name_si: "සාමාන්‍ය" }],
} = {}) => {
  let nextInvoiceId = 100;
  let nextSaleLineId = 1;
  let nextPaymentId = 1;
  let nextMovementId = 1;
  let nextExceptionId = 1;
  let nextDocId = 1;
  let nextProductId = 500;
  let nextSerialId = 1;
  let nextCustomerId = 50;

  const prodRecords = products.map((p) =>
    makeRecord({ avg_cost: 0, last_cost: null, tracking: "counted", base_unit: "pcs", allow_decimal: false, warranty_months: 0, ...p }, "product_id"),
  );
  const unitRecords = units.map((u) => makeRecord({ ...u }, "unit_id"));
  const levelRecords = levels.map((l) => makeRecord({ qty_on_hand: 0, counted_at: new Date(), updatedAt: new Date(), ...l }));
  const serialRecords = serials.map((s) => makeRecord({ serial_id: nextSerialId++, status: "in_stock", warehouse_id: 1, ...s }, "serial_id"));
  const customerRecords = customers.map((c) => makeRecord({ deposit_balance: 0, price_level: "retail", is_walk_in: false, ...c }, "customer_id"));
  const invoiceRecords = [];
  const saleLineRecords = [];
  const paymentRecords = [];
  const movementRecords = [];
  const traceRecords = [];
  const exceptionRecords = [];
  const approvalTokens = [];
  const stockDocs = [];
  const stockDocLines = [];
  const idempotencyRecords = [];

  const configRow = makeRecord({ custom_settings: { retail: { ...retailSettings } } });

  const models = {
    TenantConfig: {
      findOne: vi.fn(async () => configRow),
      create: vi.fn(async (data) => {
        configRow.custom_settings = data.custom_settings;
        return configRow;
      }),
    },
    Warehouse: {
      findByPk: vi.fn(async (id) => warehouses.find((w) => w.warehouse_id === Number(id)) || null),
      findOne: vi.fn(async () => warehouses[0] || null),
    },
    Customer: {
      findByPk: vi.fn(async (id) => customerRecords.find((c) => Number(c.customer_id) === Number(id)) || null),
      findOne: vi.fn(async ({ where } = {}) => customerRecords.find((c) => matchesWhere(c, where)) || null),
      create: vi.fn(async (data) => {
        const rec = makeRecord({ customer_id: nextCustomerId++, ...data }, "customer_id");
        customerRecords.push(rec);
        return rec;
      }),
      update: vi.fn(async () => [1]),
    },
    RetailCategory: {
      findByPk: vi.fn(async (id) => categories.find((c) => Number(c.category_id) === Number(id)) || null),
    },
    RetailBrand: {
      findByPk: vi.fn(async () => null),
    },
    RetailFamily: {
      findByPk: vi.fn(async () => null),
    },
    RetailSearchAlias: {
      findAll: vi.fn(async () => []),
    },
    RetailProduct: {
      findByPk: vi.fn(async (id) => prodRecords.find((p) => Number(p.product_id) === Number(id)) || null),
      findOne: vi.fn(async ({ where } = {}) => prodRecords.find((p) => matchesWhere(p, where)) || null),
      findAll: vi.fn(async ({ where } = {}) =>
        prodRecords
          .filter((p) => matchesWhere(p, where))
          .map((p) => {
            p.RetailProductUnits = unitRecords.filter((u) => Number(u.product_id) === Number(p.product_id));
            return p;
          }),
      ),
      create: vi.fn(async (data) => {
        const rec = makeRecord({ product_id: nextProductId++, ...data }, "product_id");
        prodRecords.push(rec);
        return rec;
      }),
      update: vi.fn(async (patch, { where } = {}) => {
        let count = 0;
        for (const p of prodRecords) {
          if (matchesWhere(p, where)) {
            Object.assign(p, patch);
            count += 1;
          }
        }
        return [count];
      }),
    },
    RetailProductUnit: {
      findAll: vi.fn(async ({ where } = {}) => unitRecords.filter((u) => matchesWhere(u, where))),
    },
    RetailStockLevel: {
      findOne: vi.fn(async ({ where } = {}) => levelRecords.find((l) => matchesWhere(l, where)) || null),
      findAll: vi.fn(async ({ where } = {}) => levelRecords.filter((l) => matchesWhere(l, where))),
      create: vi.fn(async (data) => {
        const rec = makeRecord({ qty_on_hand: 0, counted_at: null, updatedAt: new Date(), ...data }, null);
        levelRecords.push(rec);
        return rec;
      }),
      findOrCreate: vi.fn(async ({ where, defaults }) => {
        let found = levelRecords.find((l) => matchesWhere(l, where));
        if (found) return [found, false];
        found = makeRecord({ ...where, ...defaults }, null);
        levelRecords.push(found);
        return [found, true];
      }),
      update: vi.fn(async (patch, { where } = {}) => {
        let count = 0;
        for (const l of levelRecords) {
          if (matchesWhere(l, where)) {
            Object.assign(l, patch);
            count += 1;
          }
        }
        return [count];
      }),
    },
    RetailStockMovement: {
      create: vi.fn(async (data) => {
        const rec = makeRecord({ movement_id: nextMovementId++, ...data }, "movement_id");
        movementRecords.push(rec);
        return rec;
      }),
      findAll: vi.fn(async ({ where } = {}) => movementRecords.filter((m) => matchesWhere(m, where))),
    },
    RetailSerial: {
      findOne: vi.fn(async ({ where } = {}) => serialRecords.find((s) => matchesWhere(s, where)) || null),
      findAll: vi.fn(async ({ where } = {}) => serialRecords.filter((s) => matchesWhere(s, where))),
      create: vi.fn(async (data) => {
        const rec = makeRecord({ serial_id: nextSerialId++, ...data }, "serial_id");
        serialRecords.push(rec);
        return rec;
      }),
    },
    RetailStockDocument: {
      create: vi.fn(async (data) => {
        const rec = makeRecord({ doc_id: nextDocId++, ...data }, "doc_id");
        stockDocs.push(rec);
        return rec;
      }),
      findByPk: vi.fn(async (id) => stockDocs.find((d) => Number(d.doc_id) === Number(id)) || null),
      findAll: vi.fn(async () => stockDocs),
    },
    RetailStockDocumentLine: {
      create: vi.fn(async (data) => {
        const rec = makeRecord({ ...data });
        stockDocLines.push(rec);
        return rec;
      }),
    },
    Invoice: {
      create: vi.fn(async (data) => {
        const rec = makeRecord({ invoice_id: nextInvoiceId++, issued_date: data.issued_date || new Date(), ...data }, "invoice_id");
        invoiceRecords.push(rec);
        return rec;
      }),
      findByPk: vi.fn(async (id) => invoiceRecords.find((i) => Number(i.invoice_id) === Number(id)) || null),
      unscoped: () => ({
        findByPk: vi.fn(async (id) => invoiceRecords.find((i) => Number(i.invoice_id) === Number(id)) || null),
      }),
    },
    InvoiceSaleLine: {
      create: vi.fn(async (data) => {
        const rec = makeRecord({ sale_line_id: nextSaleLineId++, ...data }, "sale_line_id");
        saleLineRecords.push(rec);
        return rec;
      }),
      findAll: vi.fn(async ({ where } = {}) =>
        saleLineRecords
          .filter((l) => matchesWhere(l, where))
          .map((l) => {
            l.Invoice = invoiceRecords.find((i) => Number(i.invoice_id) === Number(l.invoice_id)) || null;
            return l;
          }),
      ),
      findAndCountAll: vi.fn(async ({ where, limit = 20, offset = 0 } = {}) => {
        const rows = saleLineRecords
          .filter((l) => matchesWhere(l, where))
          .map((l) => {
            l.Invoice = invoiceRecords.find((i) => Number(i.invoice_id) === Number(l.invoice_id)) || null;
            return l;
          });
        return { count: rows.length, rows: rows.slice(offset, offset + limit) };
      }),
      update: vi.fn(async (patch, { where } = {}) => {
        let count = 0;
        for (const l of saleLineRecords) {
          if (matchesWhere(l, where)) {
            Object.assign(l, patch);
            count += 1;
          }
        }
        return [count];
      }),
    },
    Payment: {
      create: vi.fn(async (data) => {
        const rec = makeRecord({ payment_id: nextPaymentId++, ...data }, "payment_id");
        paymentRecords.push(rec);
        return rec;
      }),
    },
    InvoiceTrace: {
      create: vi.fn(async (data) => {
        const rec = makeRecord(data);
        traceRecords.push(rec);
        return rec;
      }),
    },
    CounterException: {
      create: vi.fn(async (data) => {
        const rec = makeRecord({ exception_id: nextExceptionId++, ...data }, "exception_id");
        exceptionRecords.push(rec);
        return rec;
      }),
      findAll: vi.fn(async ({ where } = {}) => exceptionRecords.filter((e) => matchesWhere(e, where))),
    },
    ApprovalToken: {
      findByPk: vi.fn(async (tokenHash) => approvalTokens.find((t) => t.token_hash === tokenHash) || null),
      update: vi.fn(async (patch, { where } = {}) => {
        const rec = approvalTokens.find(
          (t) =>
            t.token_hash === where.token_hash &&
            (where.used_at === null ? t.used_at == null : true) &&
            (!where.expires_at?.[Op.gt] || new Date(t.expires_at) > new Date(where.expires_at[Op.gt])),
        );
        if (!rec) return [0];
        Object.assign(rec, patch);
        return [1];
      }),
    },
    User: {
      findByPk: vi.fn(async (id) =>
        makeRecord({ user_id: id, first_name: "Test", last_name: "Cashier", username: "cashier", Roles: [] }, "user_id"),
      ),
    },
    IdempotencyKey: {
      findByPk: vi.fn(async (key) => idempotencyRecords.find((r) => r.key === key) || null),
      findOne: vi.fn(async ({ where } = {}) => idempotencyRecords.find((r) => matchesWhere(r, where)) || null),
      create: vi.fn(async (data) => {
        const existing = idempotencyRecords.find((r) => r.key === data.key);
        if (existing) {
          const err = new Error("Duplicate");
          err.name = "SequelizeUniqueConstraintError";
          throw err;
        }
        const rec = makeRecord({ ...data });
        idempotencyRecords.push(rec);
        return rec;
      }),
      update: vi.fn(async (patch, { where } = {}) => {
        const rec = idempotencyRecords.find((r) => r.key === where.key);
        if (!rec) return [0];
        Object.assign(rec, patch);
        return [1];
      }),
      destroy: vi.fn(async ({ where } = {}) => {
        const idx = idempotencyRecords.findIndex((r) => r.key === where.key);
        if (idx >= 0) idempotencyRecords.splice(idx, 1);
      }),
    },
    sequelize: {
      transaction: vi.fn(async (fn) => {
        const t = { LOCK: { UPDATE: "UPDATE" } };
        return fn(t);
      }),
      query: vi.fn(async (sql, { replacements = [] } = {}) => {
        if (sql.includes("qty_on_hand = qty_on_hand - ?")) {
          const [dec, now, pid, wid, allowNegFlag, decMin] = replacements;
          const level = levelRecords.find((l) => Number(l.product_id) === Number(pid) && Number(l.warehouse_id) === Number(wid));
          if (!level) return [null, { affectedRows: 0 }];
          if (!allowNegFlag && Number(level.qty_on_hand) < Number(decMin)) {
            return [null, { affectedRows: 0 }];
          }
          level.qty_on_hand = Math.round((Number(level.qty_on_hand) - Number(dec)) * 1000) / 1000;
          level.updatedAt = now;
          return [null, { affectedRows: 1 }];
        }
        if (sql.includes("qty_on_hand = qty_on_hand + ?")) {
          const [inc, now, pid, wid] = replacements;
          const level = levelRecords.find((l) => Number(l.product_id) === Number(pid) && Number(l.warehouse_id) === Number(wid));
          if (!level) return [null, { affectedRows: 0 }];
          level.qty_on_hand = Math.round((Number(level.qty_on_hand) + Number(inc)) * 1000) / 1000;
          level.updatedAt = now;
          return [null, { affectedRows: 1 }];
        }
        return [null, { affectedRows: 0 }];
      }),
    },
  };

  const issueApprovalToken = ({ action, context = {}, requesterUserId = 1, approverUserId = 99 }) => {
    const raw = `tok-${crypto.randomBytes(8).toString("hex")}`;
    approvalTokens.push({
      token_hash: sha256Hex(raw),
      action,
      requester_user_id: requesterUserId,
      approver_user_id: approverUserId,
      context_hash: hashContext(context),
      used_at: null,
      expires_at: new Date(Date.now() + 60_000),
    });
    return raw;
  };

  return {
    models,
    prodRecords,
    levelRecords,
    serialRecords,
    customerRecords,
    invoiceRecords,
    saleLineRecords,
    paymentRecords,
    movementRecords,
    exceptionRecords,
    issueApprovalToken,
  };
};

describe("R3-backend: Retail sales on a bill", () => {
  it("1. sale-only bill with packs and contractor price computes server totals & deducts base_qty", async () => {
    const h = makeSalesHarness({
      products: [
        { product_id: 1, code: "S1", name: "Bolt 6mm", sell_price: 20, contractor_price: 15, avg_cost: 10 },
      ],
      units: [{ unit_id: 11, product_id: 1, unit_name: "box", factor: 10, sell_price: 180 }],
      levels: [{ product_id: 1, warehouse_id: 1, qty_on_hand: 50 }],
      customers: [{ customer_id: 5, first_name: "Ali", price_level: "contractor", is_walk_in: false }],
    });

    const bill = await createDispatchInvoice(
      h.models,
      {
        customer_id: 5,
        sale_items: [{ product_id: 1, unit_id: 11, qty: 2 }],
        settle_now: true,
        payment: { amount: 300, method: "Cash" },
        job_site: "Kandy Site",
        customer_po: "PO-88",
      },
      1,
    );

    expect(bill.bill_kind).toBe("sale");
    expect(bill.status).toBe("Completed");
    expect(Number(bill.total_amount)).toBe(300); // 2 boxes * 10 * 15 contractor price
    expect(Number(bill.sale_total)).toBe(300);
    expect(h.saleLineRecords[0].price_source).toBe("contractor");
    expect(Number(h.saleLineRecords[0].base_qty)).toBe(20);
    expect(Number(h.levelRecords[0].qty_on_hand)).toBe(30);
    expect(h.movementRecords[0].type).toBe("SALE");
    expect(Number(h.movementRecords[0].qty_change)).toBe(-20);
  });

  it("2. price_changed 409 when stale or unapproved, and approved override consumes token once", async () => {
    const h = makeSalesHarness({
      products: [{ product_id: 1, code: "S1", name: "Cement", sell_price: 2400, avg_cost: 2000 }],
      levels: [{ product_id: 1, warehouse_id: 1, qty_on_hand: 20 }],
      customers: [{ customer_id: 5, first_name: "Ali", price_level: "retail" }],
    });

    await expect(
      createDispatchInvoice(
        h.models,
        {
          customer_id: 5,
          sale_items: [{ product_id: 1, qty: 1, expected_unit_price: 2300 }],
          payment: { amount: 2300, method: "Cash" },
        },
        1,
      ),
    ).rejects.toMatchObject({ statusCode: 409, code: "price_changed" });

    const token = h.issueApprovalToken({
      action: "price_change",
      context: { product_id: 1, unit_price: 2250 },
    });

    const bill = await createDispatchInvoice(
      h.models,
      {
        customer_id: 5,
        sale_items: [{ product_id: 1, qty: 2, unit_price: 2250 }],
        approval_tokens: { price_change: token },
        settle_now: true,
        payment: { amount: 4500, method: "Cash" },
      },
      1,
    );

    expect(Number(bill.total_amount)).toBe(4500);
    expect(h.saleLineRecords[0].price_source).toBe("approved_override");
    expect(h.exceptionRecords.some((e) => e.type === "price_change" && e.status === "approved")).toBe(true);

    // Token cannot be reused
    await expect(
      createDispatchInvoice(
        h.models,
        {
          customer_id: 5,
          sale_items: [{ product_id: 1, qty: 1, unit_price: 2250 }],
          approval_tokens: { price_change: token },
          payment: { amount: 2250, method: "Cash" },
        },
        1,
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("3. discount over cashierMaxDiscountPct requires manager approval", async () => {
    const h = makeSalesHarness({
      products: [{ product_id: 1, code: "S1", name: "Saw", sell_price: 1000 }],
      levels: [{ product_id: 1, warehouse_id: 1, qty_on_hand: 10 }],
      customers: [{ customer_id: 5, first_name: "Ali" }],
      retailSettings: { discountLimitPct: 5 },
    });

    await expect(
      createDispatchInvoice(
        h.models,
        {
          customer_id: 5,
          sale_items: [{ product_id: 1, qty: 1 }],
          discount: 100, // 10% > 5%
          payment: { amount: 900, method: "Cash" },
        },
        1,
      ),
    ).rejects.toMatchObject({ statusCode: 403, code: "discount_over_limit" });

    const token = h.issueApprovalToken({
      action: "discount_over_limit",
      context: { discount_amount: 100 },
    });

    const bill = await createDispatchInvoice(
      h.models,
      {
        customer_id: 5,
        sale_items: [{ product_id: 1, qty: 1 }],
        discount: 100,
        approval_tokens: { discount_over_limit: token },
        settle_now: true,
        payment: { amount: 900, method: "Cash" },
      },
      1,
    );

    expect(Number(bill.total_amount)).toBe(900);
    expect(Number(h.saleLineRecords[0].bill_discount_share)).toBe(100);
    expect(h.exceptionRecords.some((e) => e.type === "discount_over_limit")).toBe(true);
  });

  it("4. walk-in must pay in full (422 if short)", async () => {
    const h = makeSalesHarness({
      products: [{ product_id: 1, code: "S1", name: "Tape", sell_price: 500 }],
      levels: [{ product_id: 1, warehouse_id: 1, qty_on_hand: 10 }],
    });

    await expect(
      createDispatchInvoice(
        h.models,
        {
          walk_in: true,
          sale_items: [{ product_id: 1, qty: 1 }],
          payment: { amount: 400, method: "Cash" },
        },
        1,
      ),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it("5. settle_now -> Completed; credit sale -> PendingPayment", async () => {
    const h = makeSalesHarness({
      products: [{ product_id: 1, code: "S1", name: "Hammer", sell_price: 1000 }],
      levels: [{ product_id: 1, warehouse_id: 1, qty_on_hand: 10 }],
      customers: [{ customer_id: 5, first_name: "Builder", is_walk_in: false }],
    });

    const creditBill = await createDispatchInvoice(
      h.models,
      {
        customer_id: 5,
        sale_items: [{ product_id: 1, qty: 1 }],
        settle_now: false,
        payment: { amount: 0, method: "Cash" },
      },
      1,
    );
    expect(creditBill.status).toBe("PendingPayment");

    const cashBill = await createDispatchInvoice(
      h.models,
      {
        customer_id: 5,
        sale_items: [{ product_id: 1, qty: 1 }],
        settle_now: true,
        payment: { amount: 1000, method: "Cash" },
      },
      1,
    );
    expect(cashBill.status).toBe("Completed");
  });

  it("6. unlisted line creates COUNTER_EXCEPTIONS and takes no stock", async () => {
    const h = makeSalesHarness({
      customers: [{ customer_id: 5, first_name: "Ali" }],
    });

    const bill = await createDispatchInvoice(
      h.models,
      {
        customer_id: 5,
        sale_items: [{ line_kind: "unlisted", description: "Special Brass Valve", qty: 2, unit_price: 350 }],
        effectivePermissions: ["retail:sell_unlisted"],
        settle_now: true,
        payment: { amount: 700, method: "Cash" },
      },
      1,
    );

    expect(Number(bill.total_amount)).toBe(700);
    expect(h.saleLineRecords[0].line_kind).toBe("unlisted");
    expect(h.movementRecords).toHaveLength(0);
    expect(h.exceptionRecords.some((e) => e.type === "unlisted_sale")).toBe(true);
  });

  it("7. sundry line works without catalog product or stock", async () => {
    const h = makeSalesHarness({
      customers: [{ customer_id: 5, first_name: "Ali" }],
    });

    const bill = await createDispatchInvoice(
      h.models,
      {
        customer_id: 5,
        sale_items: [{ line_kind: "sundry", description: "Delivery / Cutting Fee", qty: 1, unit_price: 250 }],
        effectivePermissions: ["retail:sell_unlisted"],
        settle_now: true,
        payment: { amount: 250, method: "Cash" },
      },
      1,
    );

    expect(Number(bill.total_amount)).toBe(250);
    expect(h.saleLineRecords[0].line_kind).toBe("sundry");
    expect(h.movementRecords).toHaveLength(0);
  });

  it("8. serial sale marks serial sold and sets warranty_end", async () => {
    const h = makeSalesHarness({
      products: [
        {
          product_id: 1,
          code: "DRILL-1",
          name: "Bosch Drill",
          tracking: "serial",
          warranty_months: 12,
          sell_price: 15000,
          avg_cost: 11000,
        },
      ],
      levels: [{ product_id: 1, warehouse_id: 1, qty_on_hand: 1 }],
      serials: [{ product_id: 1, serial_no: "SN-999", warehouse_id: 1, status: "in_stock" }],
      customers: [{ customer_id: 5, first_name: "Ali" }],
    });

    await createDispatchInvoice(
      h.models,
      {
        customer_id: 5,
        sale_items: [{ product_id: 1, qty: 1, serial_number: "SN-999" }],
        settle_now: true,
        payment: { amount: 15000, method: "Cash" },
      },
      1,
    );

    expect(h.serialRecords[0].status).toBe("sold");
    expect(h.serialRecords[0].warranty_end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number(h.levelRecords[0].qty_on_hand)).toBe(0);
  });

  it("9. block vs warn vs not-counted, with negative_stock approval", async () => {
    // a) block refuses without approval
    const hBlock = makeSalesHarness({
      products: [{ product_id: 1, code: "S1", name: "Wire", sell_price: 100 }],
      levels: [{ product_id: 1, warehouse_id: 1, qty_on_hand: 0, counted_at: new Date() }],
      customers: [{ customer_id: 5, first_name: "Ali" }],
      retailSettings: { negativeStock: "block" },
    });

    await expect(
      createDispatchInvoice(
        hBlock.models,
        { customer_id: 5, sale_items: [{ product_id: 1, qty: 1 }], payment: { amount: 100, method: "Cash" } },
        1,
      ),
    ).rejects.toMatchObject({ statusCode: 409, code: "out_of_stock" });

    // b) block succeeds with negative_stock approval token
    const negToken = hBlock.issueApprovalToken({ action: "negative_stock", context: { product_id: 1 } });
    await createDispatchInvoice(
      hBlock.models,
      {
        customer_id: 5,
        sale_items: [{ product_id: 1, qty: 1 }],
        approval_tokens: { negative_stock: negToken },
        payment: { amount: 100, method: "Cash" },
      },
      1,
    );
    expect(Number(hBlock.levelRecords[0].qty_on_hand)).toBe(-1);

    // c) warn allows negative and records exception
    const hWarn = makeSalesHarness({
      products: [{ product_id: 1, code: "S1", name: "Wire", sell_price: 100 }],
      levels: [{ product_id: 1, warehouse_id: 1, qty_on_hand: 0, counted_at: new Date() }],
      customers: [{ customer_id: 5, first_name: "Ali" }],
      retailSettings: { negativeStock: "warn" },
    });
    await createDispatchInvoice(
      hWarn.models,
      { customer_id: 5, sale_items: [{ product_id: 1, qty: 1 }], payment: { amount: 100, method: "Cash" } },
      1,
    );
    expect(Number(hWarn.levelRecords[0].qty_on_hand)).toBe(-1);
    expect(hWarn.exceptionRecords.some((e) => e.type === "negative_stock")).toBe(true);

    // d) not-counted item (counted_at: null) is never blocked even under block
    const hUncounted = makeSalesHarness({
      products: [{ product_id: 1, code: "S1", name: "Wire", sell_price: 100 }],
      levels: [{ product_id: 1, warehouse_id: 1, qty_on_hand: 0, counted_at: null }],
      customers: [{ customer_id: 5, first_name: "Ali" }],
      retailSettings: { negativeStock: "block" },
    });
    await createDispatchInvoice(
      hUncounted.models,
      { customer_id: 5, sale_items: [{ product_id: 1, qty: 2 }], payment: { amount: 200, method: "Cash" } },
      1,
    );
    expect(Number(hUncounted.levelRecords[0].qty_on_hand)).toBe(-2);
  });

  it("10. concurrent last-unit sale under block: only one wins", async () => {
    const h = makeSalesHarness({
      products: [{ product_id: 1, code: "S1", name: "Last Unit", sell_price: 500 }],
      levels: [{ product_id: 1, warehouse_id: 1, qty_on_hand: 1, counted_at: new Date() }],
      customers: [{ customer_id: 5, first_name: "Ali" }],
      retailSettings: { negativeStock: "block" },
    });

    const results = await Promise.allSettled([
      createDispatchInvoice(
        h.models,
        { customer_id: 5, sale_items: [{ product_id: 1, qty: 1 }], payment: { amount: 500, method: "Cash" } },
        1,
      ),
      createDispatchInvoice(
        h.models,
        { customer_id: 5, sale_items: [{ product_id: 1, qty: 1 }], payment: { amount: 500, method: "Cash" } },
        1,
      ),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.code).toBe("out_of_stock");
    expect(Number(h.levelRecords[0].qty_on_hand)).toBe(0);
  });

  it("11. records unit_cost from avg_cost for profit reports", async () => {
    const h = makeSalesHarness({
      products: [{ product_id: 1, code: "S1", name: "Paint", sell_price: 1200, avg_cost: 845.5 }],
      levels: [{ product_id: 1, warehouse_id: 1, qty_on_hand: 5 }],
      customers: [{ customer_id: 5, first_name: "Ali" }],
    });

    await createDispatchInvoice(
      h.models,
      { customer_id: 5, sale_items: [{ product_id: 1, qty: 2 }], payment: { amount: 2400, method: "Cash" } },
      1,
    );

    expect(Number(h.saleLineRecords[0].unit_cost)).toBe(845.5);
    expect(Number(h.movementRecords[0].unit_cost)).toBe(845.5);
  });

  it("12. desk link takes stock dated at sale time and keeps bill totals", async () => {
    const saleDate = new Date("2026-11-20T09:00:00Z");
    const h = makeSalesHarness({
      products: [{ product_id: 1, code: "S1", name: "Brass Valve", sell_price: 400, avg_cost: 220 }],
      levels: [{ product_id: 1, warehouse_id: 1, qty_on_hand: 10 }],
      customers: [{ customer_id: 5, first_name: "Ali" }],
    });

    const bill = await createDispatchInvoice(
      h.models,
      {
        customer_id: 5,
        issued_date: saleDate,
        sale_items: [{ line_kind: "unlisted", description: "Brass Valve", qty: 2, unit_price: 350 }],
        effectivePermissions: ["retail:sell_unlisted"],
        settle_now: true,
        payment: { amount: 700, method: "Cash" },
      },
      1,
    );

    const desk = await getApprovalDesk(h.models, { tab: "to_sort" });
    expect(desk.items).toHaveLength(1);

    await linkUnlistedSaleLines(h.models, {
      saleLineIds: [h.saleLineRecords[0].sale_line_id],
      productId: 1,
      userId: 2,
    });

    expect(Number(bill.total_amount)).toBe(700); // Bill totals never change
    expect(Number(h.levelRecords[0].qty_on_hand)).toBe(8);
    expect(new Date(h.movementRecords[0].occurred_at).toISOString()).toBe(saleDate.toISOString());
  });

  it("13. desk create + opening creates product, posts opening stock, and links line", async () => {
    const h = makeSalesHarness({
      customers: [{ customer_id: 5, first_name: "Ali" }],
    });

    await createDispatchInvoice(
      h.models,
      {
        customer_id: 5,
        sale_items: [{ line_kind: "unlisted", description: "Custom Flange", qty: 2, unit_price: 500 }],
        effectivePermissions: ["retail:sell_unlisted"],
        payment: { amount: 1000, method: "Cash" },
      },
      1,
    );

    const res = await createAndLinkUnlistedSaleLines(h.models, {
      saleLineIds: [h.saleLineRecords[0].sale_line_id],
      productPayload: {
        name: "Custom Flange",
        category_id: 1,
        sell_price: 500,
        avg_cost: 300,
        tracking: "counted",
      },
      openingQty: 10,
      openingCost: 300,
      userId: 2,
    });

    expect(res.product.created_via).toBe("from_unlisted");
    expect(Number(h.levelRecords[0].qty_on_hand)).toBe(8); // 10 opening - 2 sold
    const integrity = await checkStockIntegrity(h.models);
    expect(integrity.ok).toBe(true);
  });

  it("14. desk one-off clears unlisted line from To Sort desk", async () => {
    const h = makeSalesHarness({
      customers: [{ customer_id: 5, first_name: "Ali" }],
    });

    await createDispatchInvoice(
      h.models,
      {
        customer_id: 5,
        sale_items: [{ line_kind: "unlisted", description: "One-off Scrap", qty: 1, unit_price: 150 }],
        effectivePermissions: ["retail:sell_unlisted"],
        payment: { amount: 150, method: "Cash" },
      },
      1,
    );

    await markUnlistedOneOff(h.models, {
      saleLineIds: [h.saleLineRecords[0].sale_line_id],
      userId: 2,
    });

    const desk = await getApprovalDesk(h.models, { tab: "to_sort" });
    expect(desk.items).toHaveLength(0);
  });

  it("15. sale bills cannot be deleted yet (409) & quickPad max 24 enforced", async () => {
    const h = makeSalesHarness({
      products: [{ product_id: 1, code: "S1", name: "Tape", sell_price: 100 }],
      levels: [{ product_id: 1, warehouse_id: 1, qty_on_hand: 5 }],
      customers: [{ customer_id: 5, first_name: "Ali" }],
    });

    const bill = await createDispatchInvoice(
      h.models,
      {
        customer_id: 5,
        sale_items: [{ product_id: 1, qty: 1 }],
        payment: { amount: 100, method: "Cash" },
      },
      1,
    );

    await expect(
      deleteInvoice(h.models, bill.invoice_id, { userId: 1, permissions: new Set(["*"]) }, { reason: "Created by mistake" }),
    ).rejects.toMatchObject({ statusCode: 409 });

    await expect(
      updateRetailSettings(h.models, { quickPad: Array.from({ length: 25 }, (_, i) => i + 1) }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("16. idempotent double submit of a sale bill creates only one bill", async () => {
    const h = makeSalesHarness({
      products: [{ product_id: 1, code: "S1", name: "Bolt", sell_price: 250 }],
      levels: [{ product_id: 1, warehouse_id: 1, qty_on_hand: 10 }],
      customers: [{ customer_id: 5, first_name: "Ali" }],
    });

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { userId: 1, tenantDbName: "geargrid_test" };
      req.tenantModels = h.models;
      next();
    });
    app.post("/api/invoices", idempotency(), async (req, res, next) => {
      try {
        const invoice = await createDispatchInvoice(h.models, req.body, req.user.userId);
        res.status(201).json({ status: "success", data: { invoice } });
      } catch (err) {
        next(err);
      }
    });

    const payload = {
      customer_id: 5,
      sale_items: [{ product_id: 1, qty: 2 }],
      settle_now: true,
      payment: { amount: 500, method: "Cash" },
    };

    const res1 = await request(app).post("/api/invoices").set("Idempotency-Key", "sale-idem-1").send(payload);
    const res2 = await request(app).post("/api/invoices").set("Idempotency-Key", "sale-idem-1").send(payload);

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);
    expect(res1.body.data.invoice.invoice_id).toBe(res2.body.data.invoice.invoice_id);
    expect(h.invoiceRecords).toHaveLength(1);
    expect(Number(h.levelRecords[0].qty_on_hand)).toBe(8);
  });
});
