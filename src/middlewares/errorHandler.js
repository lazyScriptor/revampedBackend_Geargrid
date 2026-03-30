import AppError from "../utils/AppError.js"; // <-- Add this line!

const errorHandler = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || "error";

  let error = { ...err };
  error.message = err.message;

  // 🚨 Catch Sequelize Validation Errors
  if (
    err.name === "SequelizeValidationError" ||
    err.name === "SequelizeUniqueConstraintError"
  ) {
    const message = err.errors.map((e) => e.message).join(", ");
    error = new AppError(`Database Error: ${message}`, 400);
  }

  // Send the response
  res.status(error.statusCode).json({
    status: error.status,
    message: error.message,
    // stack: err.stack // Uncomment this in development to see exactly where it broke!
  });
};

export default errorHandler;
