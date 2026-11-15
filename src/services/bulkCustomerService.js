import { Readable } from "stream";
import { Op } from "sequelize";
import csvParser from "csv-parser";
import { Parser } from "json2csv";
import { syncCustomerPhones } from "./customerPhoneService.js";
import { notifyEvent } from "./pushEventService.js";

const CSV_FIELDS = [
  "nic_number", // Used as unique identifier
  "customer_type",
  "company_name",
  "first_name",
  "last_name",
  "phone_number",
  "address_line1",
  "address_line2",
  "deposit_balance",
  "status",
];

export const generateTemplate = () => {
  const json2csvParser = new Parser({ fields: CSV_FIELDS });
  return json2csvParser.parse([]);
};

export const exportCustomers = async (models) => {
  const customers = await models.Customer.findAll({
    raw: true,
    attributes: CSV_FIELDS,
  });
  if (!customers || customers.length === 0) return generateTemplate();
  const json2csvParser = new Parser({ fields: CSV_FIELDS });
  return json2csvParser.parse(customers);
};

export const importCustomers = async (models, fileBuffer, actorUserId = null) => {
  return new Promise((resolve, reject) => {
    const results = [];
    const errors = [];
    let rowNumber = 1;

    const stream = Readable.from(fileBuffer);
    stream
      .pipe(csvParser())
      .on("data", (data) => {
        rowNumber++;
        try {
          if (
            !data.nic_number ||
            !data.first_name ||
            !data.last_name ||
            !data.phone_number
          ) {
            throw new Error(
              `Missing required fields (nic_number, first_name, last_name, phone_number)`,
            );
          }
          const cleanRow = {
            nic_number: data.nic_number.trim(),
            customer_type:
              data.customer_type === "Business" ? "Business" : "Individual",
            company_name: data.company_name || null,
            first_name: data.first_name.trim(),
            last_name: data.last_name.trim(),
            phone_number: data.phone_number.trim(),
            address_line1: data.address_line1 || null,
            address_line2: data.address_line2 || null,
            deposit_balance: parseFloat(data.deposit_balance) || 0,
            status: data.status === "Blacklisted" ? "Blacklisted" : "Active",
            brief_changed_at: new Date(),
          };
          results.push(cleanRow);
        } catch (err) {
          errors.push({ row: rowNumber, message: err.message });
        }
      })
      .on("end", async () => {
        try {
          const newlyBlacklisted = [];
          if (results.length > 0) {
            const blacklistedRows = results.filter((r) => r.status === "Blacklisted");
            let alreadyBlacklistedNics = new Set();
            if (blacklistedRows.length > 0 && models.Customer?.findAll) {
              const existing = await models.Customer.findAll({
                where: {
                  nic_number: { [Op.in]: blacklistedRows.map((r) => r.nic_number) },
                  status: "Blacklisted",
                },
                attributes: ["nic_number"],
              });
              alreadyBlacklistedNics = new Set((existing || []).map((c) => c.nic_number));
            }
            for (const row of blacklistedRows) {
              if (!alreadyBlacklistedNics.has(row.nic_number)) {
                newlyBlacklisted.push(row);
              }
            }

            const runSync = async (t) => {
              const opts = t ? { transaction: t } : {};
              await models.Customer.bulkCreate(results, {
                updateOnDuplicate: [
                  "customer_type",
                  "company_name",
                  "first_name",
                  "last_name",
                  "phone_number",
                  "address_line1",
                  "address_line2",
                  "deposit_balance",
                  "status",
                  "brief_changed_at",
                ],
                ...opts,
              });

              if (models.CustomerPhone) {
                const nics = results.map((r) => r.nic_number).filter(Boolean);
                if (nics.length > 0) {
                  const syncedCustomers = await models.Customer.findAll({
                    where: { nic_number: { [Op.in]: nics } },
                    attributes: ["customer_id", "phone_number", "customer_delete_status"],
                    ...opts,
                  });
                  for (const cust of syncedCustomers) {
                    await syncCustomerPhones(models, cust, opts);
                  }
                }
              }
            };

            if (models.sequelize?.transaction) {
              await models.sequelize.transaction(runSync);
            } else {
              await runSync(undefined);
            }
          }
          for (const item of newlyBlacklisted) {
            const label =
              item.customer_type === "Business" && item.company_name
                ? item.company_name
                : `${item.first_name || ""} ${item.last_name || ""}`.trim() || item.nic_number;
            void notifyEvent(models, "customer_blacklisted", {
              actorUserId,
              customerName: label,
              vars: { customer: label, reason: "", staff: "" },
              title: `Customer blacklisted: ${label}`,
              body: `${label}${item.phone_number ? ` · ${item.phone_number}` : ""} was marked Blacklisted.`,
              data: { type: "customer_blacklisted", nic_number: String(item.nic_number || "") },
              link: "/customers",
            });
          }
          resolve({ successCount: results.length, errors });
        } catch (dbError) {
          reject(dbError);
        }
      })
      .on("error", (error) => reject(error));
  });
};
