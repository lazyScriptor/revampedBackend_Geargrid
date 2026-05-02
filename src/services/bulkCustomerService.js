import { Readable } from "stream";
import csvParser from "csv-parser";
import { Parser } from "json2csv";

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

export const importCustomers = async (models, fileBuffer) => {
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
          };
          results.push(cleanRow);
        } catch (err) {
          errors.push({ row: rowNumber, message: err.message });
        }
      })
      .on("end", async () => {
        try {
          if (results.length > 0) {
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
              ],
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
