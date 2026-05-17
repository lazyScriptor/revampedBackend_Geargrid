// Public contact endpoints — mounted at /api/contact in app.js
import express from "express";
import rateLimit from "express-rate-limit";
import {
  submitInquiry,
  sendDemoRequest,
} from "../controllers/contactController.js";

const router = express.Router();

// 5 submissions per 10 min per IP — generous for legit users, hard wall for bots.
const inquiryLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: "error",
    message: "Too many inquiries from this address. Please try again later.",
  },
});

router.post("/inquiry", inquiryLimiter, submitInquiry);
router.post("/request-demo", inquiryLimiter, sendDemoRequest);

export default router;
