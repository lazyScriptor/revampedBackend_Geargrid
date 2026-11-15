import { DataTypes, literal } from "sequelize";
import { tableExists, addIndexIfMissing } from "../lib/schemaGuards.js";
import { normalizePhone, splitPhones } from "../../src/utils/whatsappPhone.js";

const TABLE = "CUSTOMER_PHONES";

const pickPrimaryIndex = (entries) => {
  const slMobileIdx = entries.findIndex((e) => e.valid && e.kind === "mobile");
  if (slMobileIdx !== -1) return slMobileIdx;
  return entries.findIndex((e) => e.valid);
};

export const up = async ({ context: qi }) => {
  const exists = await tableExists(qi, TABLE);
  if (!exists) {
    await qi.createTable(
      TABLE,
      {
        phone_id: {
          type: DataTypes.INTEGER,
          autoIncrement: true,
          primaryKey: true,
          allowNull: false,
        },
        customer_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        phone_e164: {
          type: DataTypes.STRING(20),
          allowNull: false,
        },
        is_primary: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        createdAt: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: literal("CURRENT_TIMESTAMP"),
        },
        updatedAt: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"),
        },
      },
      { charset: "utf8mb4", collate: "utf8mb4_unicode_ci" },
    );
  }

  await addIndexIfMissing(qi, TABLE, ["customer_id", "phone_e164"], {
    unique: true,
    name: "uq_customer_phones_cust_e164",
  });
  await addIndexIfMissing(qi, TABLE, ["phone_e164"], {
    name: "idx_customer_phones_e164",
  });

  // Backfill active customers' phone numbers idempotently.
  if (!(await tableExists(qi, "CUSTOMERS"))) return;

  const [customers] = await qi.sequelize.query(
    `SELECT customer_id, phone_number FROM CUSTOMERS
     WHERE (customer_delete_status IS NULL OR customer_delete_status = 0)
       AND phone_number IS NOT NULL AND phone_number <> ''`,
  );

  if (!Array.isArray(customers) || customers.length === 0) return;

  const [existingRows] = await qi.sequelize.query(
    `SELECT customer_id, phone_e164 FROM \`${TABLE}\``,
  );
  const existingKeys = new Set(
    (existingRows || []).map((r) => `${r.customer_id}:${r.phone_e164}`),
  );

  const toInsert = [];
  const now = new Date();
  for (const cust of customers) {
    const parts = splitPhones(cust.phone_number);
    const seenDigits = new Set();
    const entries = [];
    for (const part of parts) {
      const parsed = normalizePhone(part);
      if (!parsed.digits || seenDigits.has(parsed.digits)) continue;
      seenDigits.add(parsed.digits);
      entries.push(parsed);
    }
    if (entries.length === 0) continue;

    const primaryIdx = pickPrimaryIndex(entries);
    entries.forEach((entry, idx) => {
      const key = `${cust.customer_id}:${entry.digits}`;
      if (!existingKeys.has(key)) {
        existingKeys.add(key);
        toInsert.push({
          customer_id: cust.customer_id,
          phone_e164: entry.digits,
          is_primary: idx === primaryIdx,
          createdAt: now,
          updatedAt: now,
        });
      }
    });
  }

  const BATCH_SIZE = 500;
  for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
    await qi.bulkInsert(TABLE, toInsert.slice(i, i + BATCH_SIZE));
  }
};

export const down = async ({ context: qi }) => {
  if (await tableExists(qi, TABLE)) {
    await qi.dropTable(TABLE);
  }
};
