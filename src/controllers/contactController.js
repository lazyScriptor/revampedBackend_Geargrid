// Public contact endpoints — no auth, called from the marketing site.
// Persists every inquiry to CONTACT_INQUIRIES in the master DB and (best-effort)
// also sends an email notification. DB write is the source of truth; email is
// a nice-to-have that must NOT fail the request if SMTP is unconfigured.

import nodemailer from "nodemailer";
import { getMasterModels } from "../models/master/index.js";
import AppError from "../utils/AppError.js";
import catchAsync from "../utils/catchAsync.js";

const VALID_INQUIRY_TYPES = ["demo", "sales", "support", "partnership", "other"];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const clientIp = (req) =>
  (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
  req.ip ||
  req.socket?.remoteAddress ||
  null;

const sendInquiryEmail = async ({ name, email, company, phone, message, inquiry_type }) => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.log("[contact] skipping email — EMAIL_USER/EMAIL_PASS not set");
    return;
  }
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: Number(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });
    await transporter.sendMail({
      from: `"GearGrid Contact" <${process.env.EMAIL_USER}>`,
      to: process.env.CONTACT_INBOX || "contact@geargrid.live",
      replyTo: email,
      subject: `New ${inquiry_type} inquiry from ${name} (${company || "no company"})`,
      text: [
        `Name: ${name}`,
        `Email: ${email}`,
        `Company: ${company || "—"}`,
        `Phone: ${phone || "—"}`,
        `Type: ${inquiry_type}`,
        "",
        "Message:",
        message,
      ].join("\n"),
    });
  } catch (err) {
    console.error("[contact] email send failed:", err.message);
  }
};

// POST /api/contact/inquiry — public form submission
export const submitInquiry = catchAsync(async (req, res) => {
  const { name, email, company, phone, inquiry_type, message } = req.body || {};

  if (!name || typeof name !== "string" || name.trim().length < 2 || name.length > 120) {
    throw new AppError("Please enter a valid name.", 400);
  }
  if (!email || !EMAIL_RE.test(email) || email.length > 255) {
    throw new AppError("Please enter a valid email address.", 400);
  }
  if (!message || typeof message !== "string" || message.trim().length < 10 || message.length > 5000) {
    throw new AppError("Message must be between 10 and 5000 characters.", 400);
  }
  if (company && (typeof company !== "string" || company.length > 120)) {
    throw new AppError("Company name is too long.", 400);
  }
  if (phone && (typeof phone !== "string" || phone.length > 40)) {
    throw new AppError("Phone number is too long.", 400);
  }
  const safeType = VALID_INQUIRY_TYPES.includes(inquiry_type) ? inquiry_type : "demo";

  const { ContactInquiry } = getMasterModels();
  const record = await ContactInquiry.create({
    name: name.trim(),
    email: email.trim().toLowerCase(),
    company: company?.trim() || null,
    phone: phone?.trim() || null,
    inquiry_type: safeType,
    message: message.trim(),
    source_ip: clientIp(req),
    user_agent: (req.headers["user-agent"] || "").slice(0, 500) || null,
    referrer: (req.headers["referer"] || "").slice(0, 500) || null,
  });

  // Fire-and-forget — response shouldn't depend on SMTP availability.
  sendInquiryEmail({
    name: record.name,
    email: record.email,
    company: record.company,
    phone: record.phone,
    message: record.message,
    inquiry_type: record.inquiry_type,
  });

  res.status(201).json({
    status: "success",
    message: "Thanks — we've received your inquiry and will be in touch within one business day.",
    inquiry_id: record.inquiry_id,
  });
});

// POST /api/contact/request-demo — legacy endpoint kept for the old modal flow
export const sendDemoRequest = catchAsync(async (req, res) => {
  const { email, message, companyName } = req.body || {};
  req.body = {
    name: companyName || (email && email.split("@")[0]) || "Anonymous",
    email,
    company: companyName,
    message: message || "Demo requested via legacy endpoint.",
    inquiry_type: "demo",
  };
  return submitInquiry(req, res);
});
