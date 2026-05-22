import exportEquipmentExcel from "./exportEquipmentExcel.js";
import exportEquipmentCsv from "./exportEquipmentCsv.js";
import exportCustomersExcel from "./exportCustomersExcel.js";
import exportCustomersCsv from "./exportCustomersCsv.js";
import exportInvoicesExcel from "./exportInvoicesExcel.js";
import importEquipment from "./importEquipment.js";
import importCustomers from "./importCustomers.js";

// Map from BulkJob.operation → handler({ tenantDbName, models, job, reportProgress })
// Handler returns:
//   { status?: "completed"|"awaiting_confirmation", resultPayload?, outputFilePath?, summary? }
export const handlers = {
  export_equipment_excel: exportEquipmentExcel,
  export_equipment_csv: exportEquipmentCsv,
  export_customers_excel: exportCustomersExcel,
  export_customers_csv: exportCustomersCsv,
  export_invoices_excel: exportInvoicesExcel,
  import_equipment: importEquipment,
  import_customers: importCustomers,
};
