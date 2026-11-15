class AppError extends Error {
  constructor(message, statusCode, code = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.status = `${statusCode}`.startsWith("4") ? "fail" : "error";
    this.isOperational = true; // Marks errors we expect (like bad passwords)
    Error.captureStackTrace(this, this.constructor);
  }
}
export default AppError;
