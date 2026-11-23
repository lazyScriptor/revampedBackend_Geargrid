import crypto from "node:crypto";
import { vi } from "vitest";
import { Op, Sequelize } from "sequelize";
import { initTenantModels } from "../../src/models/index.js";
import { hashContext, sha256Hex } from "../../src/modules/retail/index.js";

// The mocks below run the real model rules (required columns, allowed values) on every
// saved bill and sale line, so a value the database would refuse fails here too.
const realModels = initTenantModels(new Sequelize("mysql://u:p@127.0.0.1:1/none", { logging: false }));
export const assertSavable = async (modelName, data) => {
  await realModels[modelName].build(data).validate();
};

export const makeRecord = (data, pkField) => {
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

export const matchesWhere = (row, where = {}) => {
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

export const makeSalesHarness = ({
  products = [],
  units = [],
  levels = [],
  serials = [],
  customers = [],
  retailSettings = {},
  warehouses = [{ warehouse_id: 1, location_name: "Main", is_default: true }],
  categories = [{ category_id: 1, name: "General", name_si: "සාමාන්‍ය" }],
  equipment = [],
  // Undo a failed transaction's changes (off by default: tests that run bills at the same time
  // would undo each other's committed work).
  rollback = false,
} = {}) => {
  let nextInvoiceLineId = 1;
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
  const equipmentRecords = equipment.map((e) =>
    makeRecord(
      { equipment_name: "Machine", available_qty: 0, rented_qty: 0, defective_qty: 0, total_owned_qty: 0, ...e },
      "equipment_id",
    ),
  );
  for (const e of equipmentRecords) e.reload = vi.fn(async () => e);
  const invoiceLineRecords = [];
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
            p.Units = unitRecords.filter((u) => Number(u.product_id) === Number(p.product_id));
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
        await assertSavable("Invoice", data);
        const rec = makeRecord({ invoice_id: nextInvoiceId++, issued_date: data.issued_date || new Date(), ...data }, "invoice_id");
        invoiceRecords.push(rec);
        return rec;
      }),
      findByPk: vi.fn(async (id) => invoiceRecords.find((i) => Number(i.invoice_id) === Number(id)) || null),
      unscoped: () => ({
        findByPk: vi.fn(async (id) => invoiceRecords.find((i) => Number(i.invoice_id) === Number(id)) || null),
        count: vi.fn(async ({ where } = {}) => invoiceRecords.filter((i) => matchesWhere(i, where)).length),
        findAndCountAll: vi.fn(async ({ where } = {}) => {
          const rows = invoiceRecords.filter((i) => matchesWhere(i, where));
          return { count: rows.length, rows };
        }),
      }),
      count: vi.fn(async ({ where } = {}) => invoiceRecords.filter((i) => matchesWhere(i, where)).length),
      findAndCountAll: vi.fn(async ({ where } = {}) => {
        const rows = invoiceRecords
          .filter((i) => matchesWhere(i, where))
          .map((i) => {
            i.SaleLines = saleLineRecords.filter((l) => Number(l.invoice_id) === Number(i.invoice_id));
            return i;
          });
        return { count: rows.length, rows };
      }),
    },
    InvoiceSaleLine: {
      create: vi.fn(async (data) => {
        await assertSavable("InvoiceSaleLine", data);
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
    Payment: (() => {
      const payModel = {
        create: vi.fn(async (data) => {
          const rec = makeRecord({ payment_id: nextPaymentId++, is_voided: false, voided_at: null, ...data }, "payment_id");
          paymentRecords.push(rec);
          return rec;
        }),
        findAll: vi.fn(async ({ where } = {}) => paymentRecords.filter((p) => matchesWhere(p, where))),
        sum: vi.fn(async (field, { where } = {}) =>
          paymentRecords.filter((p) => matchesWhere(p, where)).reduce((s, p) => s + Number(p[field] || 0), 0),
        ),
        update: vi.fn(async (patch, { where } = {}) => {
          let count = 0;
          for (const p of paymentRecords) {
            if (matchesWhere(p, where)) {
              Object.assign(p, patch);
              count += 1;
            }
          }
          return [count];
        }),
      };
      payModel.unscoped = () => payModel;
      return payModel;
    })(),
    Equipment: {
      findByPk: vi.fn(async (id) => equipmentRecords.find((e) => Number(e.equipment_id) === Number(id)) || null),
    },
    InvoiceLine: {
      bulkCreate: vi.fn(async (rows) => {
        const out = [];
        for (const data of rows) {
          await assertSavable("InvoiceLine", data);
          const rec = makeRecord(
            { line_id: nextInvoiceLineId++, good_returned_qty: 0, defective_returned_qty: 0, ...data },
            "line_id",
          );
          invoiceLineRecords.push(rec);
          out.push(rec);
        }
        return out;
      }),
      findAll: vi.fn(async ({ where } = {}) => invoiceLineRecords.filter((l) => matchesWhere(l, where))),
      findByPk: vi.fn(async (id) => invoiceLineRecords.find((l) => Number(l.line_id) === Number(id)) || null),
      count: vi.fn(async ({ where } = {}) => invoiceLineRecords.filter((l) => matchesWhere(l, where)).length),
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
      update: vi.fn(async (patch, { where } = {}) => {
        let count = 0;
        for (const e of exceptionRecords) {
          if (matchesWhere(e, where)) {
            Object.assign(e, patch);
            count += 1;
          }
        }
        return [count];
      }),
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
      findAll: vi.fn(async () => []),
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
      // Like the database: when the work throws, everything it changed is undone.
      transaction: vi.fn(async (fn) => {
        const t = { LOCK: { UPDATE: "UPDATE" } };
        const stores = [
          equipmentRecords, invoiceLineRecords, invoiceRecords, saleLineRecords, paymentRecords,
          movementRecords, traceRecords, exceptionRecords, levelRecords, serialRecords, customerRecords, prodRecords,
        ];
        if (!rollback) return fn(t);
        const snapshot = stores.map((arr) => arr.map((rec) => [rec, { ...rec }]));
        try {
          return await fn(t);
        } catch (err) {
          stores.forEach((arr, i) => {
            arr.length = 0;
            for (const [rec, props] of snapshot[i]) {
              for (const k of Object.keys(rec)) if (!(k in props)) delete rec[k];
              Object.assign(rec, props);
              arr.push(rec);
            }
          });
          throw err;
        }
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
      context, // stored as the real ApprovalToken row does; sales check approved facts against it
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
    invoiceLineRecords,
    equipmentRecords,
    saleLineRecords,
    paymentRecords,
    movementRecords,
    exceptionRecords,
    issueApprovalToken,
  };
};

