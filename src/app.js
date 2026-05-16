import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import roleRoutes from "./routes/roleRoutes.js";
import permissionRoutes from "./routes/permissionRoutes.js";
import warehouseRoutes from "./routes/warehouseRoutes.js";
import categoryRoutes from "./routes/categoryRoutes.js";
import equipmentRoutes from "./routes/equipmentRoutes.js";
import customerRoutes from "./routes/customerRoutes.js";
import tenantConfigRoutes from "./routes/tenantConfigRoutes.js";
import defectLogRoutes from "./routes/defectLogRoutes.js";
import bulkEquipmentRoutes from "./routes/bulkEquipmentRoutes.js";
import invoiceRoutes from "./routes/invoiceRoutes.js";
import contactRoutes from "./routes/contactRoutes.js";
import errorHandler from "./middlewares/errorHandler.js";
import AppError from "./utils/AppError.js";
import bulkCustomerRoutes from "./routes/bulkCustomerRoutes.js";
import bulkInvoiceRoutes from "./routes/bulkInvoiceRoutes.js";
import reportRoutes from "./routes/reportRoutes.js";
import expenseRoutes from "./routes/expenseRoutes.js";
import superAdminRoutes from "./routes/superAdminRoutes.js";
import permissionManagementRoutes from "./routes/permissionManagementRoutes.js";
import accountingRoutes from "./routes/accountingRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import { corsOrigins } from "./config/cors-config.js";

const app = express();

app.set("trust proxy", 1);

// Dynamic CORS — origins list is mutated at runtime by Super Admin console
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (corsOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin "${origin}" is not allowed.`));
    },
    credentials: true,
  }),
);

app.use(express.json());
app.use(cookieParser());

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/roles", roleRoutes);
app.use("/api/permissions", permissionRoutes);
app.use("/api/warehouses", warehouseRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/equipment", equipmentRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/config", tenantConfigRoutes);
app.use("/api/defects", defectLogRoutes);
app.use("/api/invoices", invoiceRoutes);
app.use("/api/equipment/bulk", bulkEquipmentRoutes);
app.use("/api/customers/bulk", bulkCustomerRoutes);
app.use("/api/invoices/bulk", bulkInvoiceRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/expenses", expenseRoutes);
app.use("/api/super-admin", superAdminRoutes);
app.use("/api/permission-management", permissionManagementRoutes);
app.use("/api/accounting", accountingRoutes);
app.use("/api/dashboard", dashboardRoutes);

app.use((req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

app.use(errorHandler);

export default app;
