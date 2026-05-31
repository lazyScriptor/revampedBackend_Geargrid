#!/usr/bin/env node
/**
 * Seed Sample Data — populates a tenant DB with realistic GearGrid data so
 * the dashboard, equipment, customers, invoices, accounting and reports
 * pages all have something to render.
 *
 * Idempotent: every section checks for a marker row (or a unique serial /
 * nic / name) before inserting, so re-running just tops up missing data.
 *
 * Usage:
 *   node src/scripts/seedSampleData.js                          # tenant_template (default)
 *   node src/scripts/seedSampleData.js --tenant <db_name>
 */
import { Sequelize, QueryTypes } from "sequelize";

const args = process.argv.slice(2);
const tenantArgIdx = args.indexOf("--tenant");
const TENANT_DB = tenantArgIdx >= 0 ? args[tenantArgIdx + 1] : "geargrid_tenant_template";

const seq = new Sequelize(TENANT_DB, "root", "", {
  host: "localhost",
  dialect: "mysql",
  logging: false,
});

// ── helpers ─────────────────────────────────────────────────────────────
const exec = (sql, replacements) =>
  seq.query(sql, { replacements, type: QueryTypes.INSERT });
const fetchOne = async (sql, replacements) => {
  const [rows] = await seq.query(sql, { replacements });
  return rows[0];
};
const fetchAll = async (sql, replacements) => {
  const [rows] = await seq.query(sql, { replacements });
  return rows;
};

const randInt = (lo, hi) => Math.floor(Math.random() * (hi - lo + 1)) + lo;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
};
const ymd = (d) => d.toISOString().slice(0, 10);
const dt = (d) => d.toISOString().slice(0, 19).replace("T", " ");

// ── 1. Warehouses ───────────────────────────────────────────────────────
const ensureWarehouses = async () => {
  const wanted = [
    { location_name: "Colombo Main Hub" },
    { location_name: "Kandy Branch" },
    { location_name: "Galle Outpost" },
  ];
  let added = 0;
  for (const w of wanted) {
    const found = await fetchOne(
      "SELECT warehouse_id FROM WAREHOUSES WHERE location_name = ?",
      [w.location_name],
    );
    if (!found) {
      await exec("INSERT INTO WAREHOUSES (location_name) VALUES (?)", [w.location_name]);
      added++;
    }
  }
  return added;
};

// ── 2. Categories ───────────────────────────────────────────────────────
const ensureCategories = async () => {
  const wanted = [
    "Power Tools",
    "Bulk Items",
    "Generators & Power",
    "Air Compressors",
    "Concrete Equipment",
    "Welding Equipment",
    "Safety & PPE",
  ];
  let added = 0;
  for (const name of wanted) {
    const found = await fetchOne(
      "SELECT category_id FROM EQUIPMENT_CATEGORIES WHERE category_name = ?",
      [name],
    );
    if (!found) {
      await exec("INSERT INTO EQUIPMENT_CATEGORIES (category_name) VALUES (?)", [name]);
      added++;
    }
  }
  return added;
};

// ── 3. Equipment ────────────────────────────────────────────────────────
const SAMPLE_EQUIPMENT = [
  // Generators & Power
  { name: "Perkins 25kVA Silent Generator", sku: "PKN-25-001", cat: "Generators & Power", price: 8000, extra: 2000, qty: 1, bulk: false },
  { name: "Honda 5.5kVA Portable Generator", sku: "HND-55-002", cat: "Generators & Power", price: 4500, extra: 1200, qty: 3, bulk: false },
  { name: "Yamaha 3kVA Inverter Generator", sku: "YMH-3K-003", cat: "Generators & Power", price: 3000, extra: 800, qty: 2, bulk: false },
  // Air Compressors
  { name: "Atlas Copco 185CFM Compressor", sku: "ATC-185-004", cat: "Air Compressors", price: 6000, extra: 1500, qty: 1, bulk: false },
  { name: "Portable Air Compressor 50L", sku: "PAC-50-005", cat: "Air Compressors", price: 2500, extra: 700, qty: 4, bulk: false },
  // Concrete
  { name: "Concrete Mixer 350L (Diesel)", sku: "CMX-350-001", cat: "Concrete Equipment", price: 2500, extra: 600, qty: 3, bulk: false },
  { name: "Poker Vibrator 35mm", sku: "PVB-35-001", cat: "Concrete Equipment", price: 1200, extra: 300, qty: 6, bulk: false },
  { name: "Concrete Cutter 14\"", sku: "CCT-14-006", cat: "Concrete Equipment", price: 3000, extra: 800, qty: 2, bulk: false },
  { name: "Plate Compactor Wacker WP1540", sku: "PCW-15-001", cat: "Concrete Equipment", price: 2000, extra: 500, qty: 4, bulk: false },
  // Welding
  { name: "Lincoln MIG Welder 350A", sku: "LNK-350-007", cat: "Welding Equipment", price: 3500, extra: 900, qty: 2, bulk: false },
  { name: "Arc Welder 250A", sku: "ARC-250-001", cat: "Welding Equipment", price: 2000, extra: 500, qty: 5, bulk: false },
  { name: "Plasma Cutter 50A", sku: "PLS-50-001", cat: "Welding Equipment", price: 4500, extra: 1100, qty: 1, bulk: false },
  // Safety / PPE
  { name: "Safety Helmets Class A", sku: "SHM-CLA-001", cat: "Safety & PPE", price: 100, extra: 30, qty: 50, bulk: true },
  { name: "Safety Harness Full-Body", sku: "SHB-FB-001", cat: "Safety & PPE", price: 250, extra: 70, qty: 20, bulk: true },
  // Power Tools (extra)
  { name: "DeWalt SDS Hammer Drill", sku: "DW-SDS-001", cat: "Power Tools", price: 1600, extra: 400, qty: 4, bulk: false },
  { name: "Makita Circular Saw 7-1/4\"", sku: "MKT-CS-001", cat: "Power Tools", price: 1400, extra: 350, qty: 3, bulk: false },
];

const ensureEquipment = async () => {
  const catRows = await fetchAll("SELECT category_id, category_name FROM EQUIPMENT_CATEGORIES");
  const catMap = Object.fromEntries(catRows.map((r) => [r.category_name, r.category_id]));
  const whRows = await fetchAll("SELECT warehouse_id FROM WAREHOUSES ORDER BY warehouse_id");
  let added = 0;
  for (const e of SAMPLE_EQUIPMENT) {
    const found = await fetchOne(
      "SELECT equipment_id FROM EQUIPMENT WHERE serial_number = ?",
      [e.sku],
    );
    if (found) continue;
    const categoryId = catMap[e.cat];
    if (!categoryId) continue;
    const warehouseId = whRows[(added + 1) % whRows.length].warehouse_id;
    await exec(
      `INSERT INTO EQUIPMENT
       (category_id, warehouse_id, is_bulk_item, equipment_name, serial_number,
        total_owned_qty, available_qty, rented_qty, defective_qty,
        base_rental_price, minimum_rental_days, extra_daily_rate,
        purchase_cost, warranty_period_months, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, 1, ?, ?, 24, NOW(), NOW())`,
      [
        categoryId, warehouseId, e.bulk ? 1 : 0, e.name, e.sku,
        e.qty, e.qty, e.price, e.extra, Math.round(e.price * 30),
      ],
    );
    added++;
  }
  return added;
};

// ── 4. Customers ────────────────────────────────────────────────────────
const SAMPLE_CUSTOMERS = [
  // Businesses
  { type: "Business", company: "Apex Construction Group", first: "Roshan", last: "Fernando", phone: "0114440001", nic: "B-APEX-001", address: "12 Galle Road, Colombo 03" },
  { type: "Business", company: "Nordic Ceylon (Pvt) Ltd", first: "Lasith", last: "Wijesinghe", phone: "0114440002", nic: "B-NORD-002", address: "45 Nawala Rd, Rajagiriya" },
  { type: "Business", company: "Southern Engineers Ltd", first: "Buddhika", last: "Rajapaksa", phone: "0914440003", nic: "B-SENG-003", address: "8 Hospital Junction, Galle" },
  { type: "Business", company: "BuildRight Constructions", first: "Saman", last: "Kumara", phone: "0114440004", nic: "B-BUIL-004", address: "22 Negombo Rd, Wattala" },
  { type: "Business", company: "Janaka & Sons Hardware", first: "Janaka", last: "Pieris", phone: "0814440005", nic: "B-JAND-005", address: "Main St, Kandy" },
  // Individuals
  { type: "Individual", first: "Sajeewa", last: "Rajapaksa", phone: "0771112201", nic: "199512345678", address: "14 Temple Rd, Maharagama" },
  { type: "Individual", first: "Pubudu", last: "Dissanayake", phone: "0771112202", nic: "198912345678", address: "7B Lake View, Battaramulla" },
  { type: "Individual", first: "Dinithi", last: "Rajapaksa", phone: "0771112203", nic: "200012345678", address: "Galle Face Court, Colombo" },
  { type: "Individual", first: "Pathmanathan", last: "Kumara", phone: "0771112204", nic: "198212345678", address: "Mt Lavinia" },
  { type: "Individual", first: "Gimhani", last: "Rajapaksa", phone: "0771112205", nic: "199712345678", address: "Nugegoda" },
  { type: "Individual", first: "Ishara", last: "Madushan", phone: "0771112206", nic: "199912345678", address: "Dehiwala" },
  { type: "Individual", first: "Chamari", last: "Gunasekara", phone: "0771112207", nic: "199312345678", address: "Moratuwa" },
  { type: "Individual", first: "Kasun", last: "Perera", phone: "0771112208", nic: "199112345678", address: "Negombo" },
  { type: "Individual", first: "Niroshan", last: "Bandara", phone: "0771112209", nic: "198812345678", address: "Kurunegala" },
  { type: "Individual", first: "Tharaka", last: "Silva", phone: "0771112210", nic: "199412345678", address: "Matara" },
  { type: "Individual", first: "Amali", last: "Wickramasinghe", phone: "0771112211", nic: "199612345678", address: "Kandy" },
  // Blacklisted
  { type: "Individual", first: "Rajith", last: "Mendis", phone: "0771112299", nic: "198512348888", address: "—", status: "Blacklisted" },
];

const ensureCustomers = async () => {
  let added = 0;
  for (const c of SAMPLE_CUSTOMERS) {
    const found = await fetchOne(
      "SELECT customer_id FROM CUSTOMERS WHERE nic_number = ?",
      [c.nic],
    );
    if (found) continue;
    await exec(
      `INSERT INTO CUSTOMERS
       (customer_type, company_name, first_name, last_name, phone_number,
        nic_number, address_line1, status, rating, deposit_balance,
        is_id_retained_currently, customer_delete_status, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NOW(), NOW())`,
      [
        c.type, c.company || null, c.first, c.last, c.phone,
        c.nic, c.address, c.status || "Active",
        c.status === "Blacklisted" ? 2 : randInt(4, 5),
        c.type === "Business" ? randInt(5000, 25000) : randInt(0, 5000),
        Math.random() < 0.15 ? 1 : 0,
      ],
    );
    added++;
  }
  return added;
};

// ── 5. Invoices + Lines + Payments ──────────────────────────────────────
// We aim for ~60 invoices spanning the last 90 days, status mix:
//   ~50% Completed (paid in full)
//   ~30% Active (currently rented out)
//   ~20% Overdue (past expected return)
const INVOICE_TARGET = 60;

const seedInvoices = async () => {
  const customers = await fetchAll(
    "SELECT customer_id FROM CUSTOMERS WHERE customer_delete_status = 0 AND status = 'Active' ORDER BY customer_id",
  );
  const equipment = await fetchAll(
    "SELECT equipment_id, base_rental_price, extra_daily_rate, available_qty, total_owned_qty FROM EQUIPMENT ORDER BY equipment_id",
  );
  const users = await fetchAll("SELECT user_id FROM USERS WHERE is_active = 1 LIMIT 5");
  if (!customers.length || !equipment.length) return 0;

  const existingCount = (await fetchAll("SELECT COUNT(*) AS c FROM INVOICES"))[0].c;
  const need = Math.max(0, INVOICE_TARGET - existingCount);

  let added = 0;
  for (let i = 0; i < need; i++) {
    const customer = pick(customers);
    const issuedBy = users.length ? pick(users).user_id : null;
    const issuedDaysAgo = randInt(1, 90);
    const issuedDate = daysAgo(issuedDaysAgo);
    const days = randInt(2, 14);
    // Status mix
    const r = Math.random();
    const status =
      issuedDaysAgo + days < 5 || r < 0.5
        ? "Completed"
        : r < 0.8
          ? "Active"
          : "Overdue";

    // Pick 1-3 line items
    const lines = [];
    const lineCount = randInt(1, 3);
    for (let j = 0; j < lineCount; j++) {
      const eq = pick(equipment);
      const qty = eq.total_owned_qty > 5 ? randInt(1, 3) : 1;
      const basePrice = Number(eq.base_rental_price);
      const extra = Number(eq.extra_daily_rate);
      const lineTotal = basePrice + extra * Math.max(0, days - 1);
      const expectedReturn = new Date(issuedDate);
      expectedReturn.setDate(expectedReturn.getDate() + days);
      const isReturned = status === "Completed";
      lines.push({
        equipment_id: eq.equipment_id,
        borrow_date: ymd(issuedDate),
        expected_return_date: ymd(expectedReturn),
        actual_return_date: isReturned ? ymd(expectedReturn) : null,
        locked_base_price: basePrice,
        locked_minimum_days: 1,
        locked_extra_daily_rate: extra,
        line_total_amount: lineTotal * qty,
        borrow_quantity: qty,
        good_returned_qty: isReturned ? qty : 0,
        defective_returned_qty: 0,
        line_status: isReturned ? "Returned" : "Active",
      });
    }
    const subTotal = lines.reduce((s, l) => s + Number(l.line_total_amount), 0);
    const transportFee = randInt(0, 2) === 0 ? 500 : 0;
    const discount = Math.random() < 0.1 ? Math.round(subTotal * 0.05) : 0;
    const total = subTotal + transportFee - discount;

    const result = await exec(
      `INSERT INTO INVOICES
       (customer_id, issued_by_user_id, total_amount, advance_paid,
        id_card_status, number_of_days_of_the_bill, status,
        issued_date, transport_fee, discount_amount, sub_total)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        customer.customer_id, issuedBy, total, 0,
        status === "Active" ? 1 : 0, days, status, dt(issuedDate),
        transportFee, discount, subTotal,
      ],
    );
    const invoiceId = result[0];

    for (const ln of lines) {
      await exec(
        `INSERT INTO INVOICE_LINES
         (invoice_id, equipment_id, borrow_date, expected_return_date,
          actual_return_date, locked_base_price, locked_minimum_days,
          locked_extra_daily_rate, line_total_amount, borrow_quantity,
          good_returned_qty, defective_returned_qty, line_status, track_overdue)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          invoiceId, ln.equipment_id, ln.borrow_date, ln.expected_return_date,
          ln.actual_return_date, ln.locked_base_price, ln.locked_minimum_days,
          ln.locked_extra_daily_rate, ln.line_total_amount, ln.borrow_quantity,
          ln.good_returned_qty, ln.defective_returned_qty, ln.line_status,
        ],
      );
    }

    // Payments: Completed → fully paid; Active/Overdue → partial 0–60%
    if (status === "Completed") {
      const methods = ["Cash", "Card", "Transfer", "Cheque"];
      await exec(
        `INSERT INTO PAYMENTS (invoice_id, payment_amount, payment_date, method)
         VALUES (?, ?, ?, ?)`,
        [invoiceId, total, dt(issuedDate), pick(methods)],
      );
    } else if (Math.random() < 0.6) {
      const partial = Math.round(total * (Math.random() * 0.5 + 0.1));
      await exec(
        `INSERT INTO PAYMENTS (invoice_id, payment_amount, payment_date, method)
         VALUES (?, ?, ?, ?)`,
        [invoiceId, partial, dt(issuedDate), pick(["Cash", "Transfer"])],
      );
    }

    added++;
  }
  return added;
};

// ── 6. Expenses ─────────────────────────────────────────────────────────
const EXPENSES = [
  { category: "Operational", amount: 12000, days: 5, desc: "Diesel for delivery van" },
  { category: "Operational", amount: 4500, days: 12, desc: "Office stationery + printer toner" },
  { category: "Operational", amount: 18000, days: 18, desc: "Warehouse electricity bill" },
  { category: "Operational", amount: 6500, days: 25, desc: "Phone + broadband — March" },
  { category: "Repair", amount: 22000, days: 8, desc: "Generator alternator replacement" },
  { category: "Repair", amount: 8500, days: 14, desc: "Welder cable + connector replacement" },
  { category: "Repair", amount: 14000, days: 30, desc: "Concrete mixer drum bearing" },
  { category: "Asset Purchase", amount: 85000, days: 45, desc: "New Bosch hammer drill kit (2 units)" },
  { category: "Asset Purchase", amount: 220000, days: 60, desc: "Honda 5.5kVA generator" },
  { category: "Other", amount: 3500, days: 22, desc: "Sponsorship — local cricket club" },
  { category: "Operational", amount: 9500, days: 33, desc: "Vehicle insurance — quarterly" },
  { category: "Repair", amount: 11000, days: 50, desc: "Scaffolding clamp replacement" },
];

const seedExpenses = async () => {
  const wh = await fetchOne("SELECT warehouse_id FROM WAREHOUSES ORDER BY warehouse_id LIMIT 1");
  const user = await fetchOne("SELECT user_id FROM USERS WHERE is_active = 1 LIMIT 1");
  let added = 0;
  for (const e of EXPENSES) {
    const found = await fetchOne(
      "SELECT expense_id FROM EXPENSES WHERE description = ? AND amount = ?",
      [e.desc, e.amount],
    );
    if (found) continue;
    await exec(
      `INSERT INTO EXPENSES (category, amount, date, description, recorded_by_user_id, warehouse_id, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [e.category, e.amount, dt(daysAgo(e.days)), e.desc, user?.user_id || null, wh?.warehouse_id || null],
    );
    added++;
  }
  return added;
};

// ── 7. Defects ──────────────────────────────────────────────────────────
const seedDefects = async () => {
  // Skip if DEFECT_LOGS table doesn't exist
  const [tables] = await seq.query("SHOW TABLES LIKE 'DEFECT_LOGS'");
  if (!tables.length) return 0;

  const eq = await fetchAll(
    "SELECT equipment_id, equipment_name FROM EQUIPMENT WHERE total_owned_qty > 0 LIMIT 30",
  );
  const users = await fetchAll("SELECT user_id FROM USERS WHERE is_active = 1 LIMIT 3");
  const cols = await seq.query("DESCRIBE DEFECT_LOGS");
  const colNames = cols[0].map((c) => c.Field);

  const sampleDefects = [
    { desc: "Generator won't start — battery dead, suspect alternator", status: "Pending Assignment" },
    { desc: "Concrete mixer drum scraping — bearing worn", status: "In Repair" },
    { desc: "MIG welder gas regulator leaking", status: "In Repair" },
    { desc: "Air compressor pressure switch faulty", status: "Resolved" },
    { desc: "Hammer drill chuck stripped", status: "Pending Assignment" },
    { desc: "Plate compactor handle cracked", status: "In Repair" },
  ];

  // PK can be `defect_id` or `log_id` depending on schema age
  const pkCol = colNames.includes("defect_id") ? "defect_id" : "log_id";
  const descCol = colNames.includes("defect_description") ? "defect_description" : "description";
  const statusCol = colNames.includes("repair_status") ? "repair_status" : "status";
  const techCol = colNames.includes("assigned_technician_id") ? "assigned_technician_id" : colNames.includes("technician_id") ? "technician_id" : null;
  const hasTimestamps = colNames.includes("createdAt");

  let added = 0;
  for (const d of sampleDefects) {
    if (!eq.length) break;
    const target = pick(eq);
    const found = await fetchOne(
      `SELECT ${pkCol} FROM DEFECT_LOGS WHERE equipment_id = ? AND ${descCol} LIKE ?`,
      [target.equipment_id, d.desc.slice(0, 30) + "%"],
    );
    if (found) continue;

    const row = {
      equipment_id: target.equipment_id,
      [descCol]: d.desc,
      [statusCol]: d.status,
      reported_date: dt(daysAgo(randInt(1, 21))),
    };
    if (colNames.includes("defective_quantity")) row.defective_quantity = randInt(1, 2);
    if (colNames.includes("pending_quantity")) row.pending_quantity = d.status === "Resolved" ? 0 : 1;
    if (colNames.includes("repaired_quantity")) row.repaired_quantity = d.status === "Resolved" ? 1 : 0;
    if (colNames.includes("severity")) row.severity = pick(["Minor", "Major", "Critical"]);
    if (colNames.includes("reported_by_user_id")) row.reported_by_user_id = users[0]?.user_id || null;
    if (d.status === "Resolved") row.resolved_date = dt(daysAgo(randInt(1, 5)));
    if (techCol && d.status !== "Pending Assignment") {
      row[techCol] = users[1]?.user_id || users[0]?.user_id || null;
    }

    const usableCols = Object.keys(row).filter((k) => colNames.includes(k));
    const placeholders = usableCols.map(() => "?").join(", ");
    const extraCols = hasTimestamps ? ", createdAt, updatedAt" : "";
    const extraVals = hasTimestamps ? ", NOW(), NOW()" : "";
    await exec(
      `INSERT INTO DEFECT_LOGS (${usableCols.join(", ")}${extraCols})
       VALUES (${placeholders}${extraVals})`,
      usableCols.map((k) => row[k]),
    );
    added++;
  }
  return added;
};

// ── main ────────────────────────────────────────────────────────────────
(async () => {
  try {
    await seq.authenticate();
    console.log(`🌱 Seeding sample data → ${TENANT_DB}`);

    const w = await ensureWarehouses();
    console.log(`  warehouses: +${w}`);
    const c = await ensureCategories();
    console.log(`  categories: +${c}`);
    const e = await ensureEquipment();
    console.log(`  equipment: +${e}`);
    const cu = await ensureCustomers();
    console.log(`  customers: +${cu}`);
    const inv = await seedInvoices();
    console.log(`  invoices (+lines +payments): +${inv}`);
    const ex = await seedExpenses();
    console.log(`  expenses: +${ex}`);
    const dfx = await seedDefects();
    console.log(`  defects: +${dfx}`);

    // Final counts
    const counts = await fetchOne(`
      SELECT
        (SELECT COUNT(*) FROM WAREHOUSES) AS warehouses,
        (SELECT COUNT(*) FROM EQUIPMENT_CATEGORIES) AS categories,
        (SELECT COUNT(*) FROM EQUIPMENT) AS equipment,
        (SELECT COUNT(*) FROM CUSTOMERS WHERE customer_delete_status = 0) AS customers,
        (SELECT COUNT(*) FROM INVOICES) AS invoices,
        (SELECT COUNT(*) FROM INVOICE_LINES) AS invoice_lines,
        (SELECT COUNT(*) FROM PAYMENTS) AS payments,
        (SELECT COUNT(*) FROM EXPENSES) AS expenses
    `);
    console.log("\n📊 Final totals:");
    console.log("  " + JSON.stringify(counts, null, 0));

    await seq.close();
    console.log("\n✅ Sample data seed complete.");
    process.exit(0);
  } catch (err) {
    console.error("❌ Seed failed:", err.message);
    process.exit(1);
  }
})();
