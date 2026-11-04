// Sends GearGrid's emails through the mail account in the server's settings (EMAIL_USER, EMAIL_PASS,
// SMTP_HOST, SMTP_PORT). A failed email never fails the action that sent it: callers get
// { sent: false } and say so on screen, so the person can pass the details on another way.
import nodemailer from "nodemailer";

const APP_URL = () => process.env.APP_URL || "https://app.geargrid.live";

const escapeHtml = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const isEmailConfigured = () => !!(process.env.EMAIL_USER && process.env.EMAIL_PASS);

export const sendEmail = async ({ to, subject, text, html }) => {
  if (!isEmailConfigured()) {
    console.warn("email: EMAIL_USER / EMAIL_PASS are not set, nothing was sent");
    return { sent: false, reason: "not_configured" };
  }
  try {
    const port = Number(process.env.SMTP_PORT) || 587;
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port,
      secure: port === 465,
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
    await transporter.sendMail({ from: `"GearGrid" <${process.env.EMAIL_USER}>`, to, subject, text, html });
    return { sent: true };
  } catch (err) {
    console.error("email: could not send", err?.message);
    return { sent: false, reason: "send_failed" };
  }
};

const layout = (title, bodyHtml) => `<!doctype html><html><body style="margin:0;padding:24px;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
<div style="background:#0f172a;color:#f8fafc;padding:16px 24px;font-weight:bold;font-size:18px">GearGrid</div>
<div style="padding:24px;font-size:15px;line-height:1.5"><h2 style="margin:0 0 12px;font-size:18px">${title}</h2>${bodyHtml}</div>
<div style="padding:12px 24px;background:#f8fafc;color:#64748b;font-size:12px">GearGrid equipment rental system</div>
</div></body></html>`;
const button = (href, label) => `<p style="margin:20px 0"><a href="${escapeHtml(href)}" style="background:#f59e0b;color:#0f172a;text-decoration:none;font-weight:bold;padding:10px 18px;border-radius:8px;display:inline-block">${escapeHtml(label)}</a></p>`;
const detailRow = (label, value) => `<tr><td style="padding:4px 12px 4px 0;color:#475569">${escapeHtml(label)}</td><td style="padding:4px 0;font-weight:bold">${escapeHtml(value)}</td></tr>`;

/** A new staff member: greeting, login link, username and temporary password. */
export const sendWelcomeUserEmail = ({ to, firstName, shopName, username, password }) => {
  const name = firstName || username;
  const shop = shopName ? ` at ${shopName}` : "";
  return sendEmail({
    to,
    subject: "Welcome to GearGrid: your login details",
    text: `Hello ${name},\n\nWelcome to GearGrid${shop}. An account has been created for you.\n\nLog in: ${APP_URL()}/login\nUsername: ${username}\nEmail: ${to}\nTemporary password: ${password}\n\nYou will be asked to choose your own password when you first log in.\n`,
    html: layout(`Welcome to GearGrid, ${escapeHtml(name)}`, `<p>An account has been created for you${escapeHtml(shop)}.</p>
<table style="border-collapse:collapse">${detailRow("Username", username)}${detailRow("Email", to)}${detailRow("Temporary password", password)}</table>
${button(`${APP_URL()}/login`, "Log in to GearGrid")}<p>You will be asked to choose your own password when you first log in.</p>`),
  });
};

/** A new shop's owner: greeting and how to get in. No password: they set their own. */
export const sendWelcomeShopEmail = ({ to, shopName, username, tier }) =>
  sendEmail({
    to,
    subject: `Welcome to GearGrid, ${shopName}`,
    text: `Hello,\n\nWelcome to GearGrid. ${shopName} is ready on the ${tier} plan.\n\nLog in: ${APP_URL()}/login\nUsername: ${username}\nEmail: ${to}\n\nOn the login page, choose "Forgot password?" and enter your email to set your password.\n\nThank you for choosing GearGrid.\n`,
    html: layout(`Welcome to GearGrid, ${escapeHtml(shopName)}`, `<p>Your shop is ready on the <b>${escapeHtml(tier)}</b> plan. Thank you for choosing GearGrid.</p>
<table style="border-collapse:collapse">${detailRow("Username", username)}${detailRow("Email", to)}</table>
${button(`${APP_URL()}/login`, "Open GearGrid")}<p>On the login page, choose <b>Forgot password?</b> and enter your email to set your password.</p>`),
  });

export const sendResetCodeEmail = ({ to, code, minutes }) =>
  sendEmail({
    to,
    subject: `${code} is your GearGrid password code`,
    text: `Your GearGrid password code is ${code}.\n\nIt works for ${minutes} minutes. If you didn't ask for this, you can ignore this email: your password hasn't changed.\n`,
    html: layout("Your password code", `<p style="font-size:30px;font-weight:bold;letter-spacing:6px;margin:12px 0">${escapeHtml(code)}</p><p>It works for ${minutes} minutes. If you didn't ask for this, you can ignore this email: your password hasn't changed.</p>`),
  });

export const sendPasswordChangedEmail = ({ to }) =>
  sendEmail({
    to,
    subject: "Your GearGrid password was changed",
    text: "Your GearGrid password was just changed. If this wasn't you, contact your shop's administrator or GearGrid straight away.\n",
    html: layout("Your password was changed", "<p>Your GearGrid password was just changed. If this wasn't you, contact your shop's administrator or GearGrid straight away.</p>"),
  });
