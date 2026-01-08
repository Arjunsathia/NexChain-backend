const nodemailer = require("nodemailer");

/**
 * Sends an OTP email to the user.
 */
// Create reusable transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

/**
 * Generic send email function
 */
const sendEmail = async (to, subject, html) => {
  const mailOptions = {
    from: `"NexChain Support" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent: %s", info.messageId);
    return true;
  } catch (error) {
    console.error("Error sending email:", error);
    return false;
  }
};

/**
 * Sends an OTP email to the user.
 */
const sendOTPEmail = async (email, otp) => {
  const mailOptions = {
    from: `"NexChain Security" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Your NexChain Verification Code",
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f4f4f4;">
        <div style="max-width: 500px; margin: auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 4px 10px rgba(0,0,0,0.1);">
          <h2 style="color: #333; text-align: center;">Verify Your Account</h2>
          <p style="color: #666; font-size: 16px; text-align: center;">Your One-Time Password (OTP) is:</p>
          <div style="font-size: 32px; font-weight: bold; color: #007bff; text-align: center; margin: 20px 0; letter-spacing: 5px;">
            ${otp}
          </div>
          <p style="color: #999; font-size: 14px; text-align: center;">This code expires in 10 minutes.</p>
        </div>
      </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error("Error sending email:", error);
  }
};

module.exports = {
  sendEmail,
  sendOTPEmail,
};
