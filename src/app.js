import express from "express";
import cors from "cors";
import authRoutes from "./routes/authRoutes.js";
import errorHandler from "./middlewares/errorHandler.js";
import AppError from "./utils/AppError.js";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "success",
    message: "The revamped backend is alive and well! 🚀",
  });
});

// Main route mounting
app.use("/api/auth", authRoutes);

// Catch-all for unhandled routes (Updated for Express v5)
app.all(/(.*)/, (req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

// Global Error Handler must be the last middleware
app.use(errorHandler);

export default app;
