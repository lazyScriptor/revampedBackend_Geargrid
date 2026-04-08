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
import errorHandler from "./middlewares/errorHandler.js";
import AppError from "./utils/AppError.js";


const app = express();

app.use(
  cors({
    origin: "http://localhost:5173",
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
app.use('/api/customers', customerRoutes);
app.use('/api/config',tenantConfigRoutes)
app.use('/api/defects', defectLogRoutes)


app.use((req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

// Global Error Handler
app.use(errorHandler);

export default app;
