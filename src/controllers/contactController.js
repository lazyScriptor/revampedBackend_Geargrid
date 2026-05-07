// src/controllers/contactController.js
import nodemailer from "nodemailer";

export const sendDemoRequest = async (req, res) => {
  try {
    const { email, message, companyName } = req.body;

    // 1. Configure the email transporter
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: process.env.SMTP_PORT || 587,
      secure: false, // true for 465, false for other ports
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    // 2. Format the email you will receive
    const mailOptions = {
      from: `"${companyName || "GearGrid Portal"}" <${process.env.EMAIL_USER}>`,
      to: "contact@geargrid.live", // Where YOU receive it
      replyTo: email, // If you hit reply, it goes to the requester
      subject: `🚨 New Enterprise Demo Request from: ${email}`,
      text: `
        New Demo Request Received:
        
        From Email: ${email}
        Company Name: ${companyName || "Not provided"}
        
        Message:
        ${message}
      `,
    };

    // 3. Send the email
    await transporter.sendMail(mailOptions);

    res
      .status(200)
      .json({ status: "success", message: "Demo request sent successfully." });
  } catch (error) {
    console.error("Email sending error:", error);
    res.status(500).json({ status: "error", message: "Failed to send email." });
  }
};
