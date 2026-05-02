import { Parser } from "json2csv";

const CSV_FIELDS = [
  "invoice_id",
  "customer_id",
  "total_amount",
  "advance_paid",
  "transport_fee",
  "discount_amount",
  "sub_total",
  "status",
  "issued_date",
];

export const exportInvoices = async (models) => {
  const invoices = await models.Invoice.findAll({
    raw: true,
    attributes: CSV_FIELDS,
  });
  if (!invoices || invoices.length === 0) {
    return new Parser({ fields: CSV_FIELDS }).parse([]);
  }
  return new Parser({ fields: CSV_FIELDS }).parse(invoices);
};
