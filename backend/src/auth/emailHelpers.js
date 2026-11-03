import nodemailer from 'nodemailer';
import { getAppBaseUrl } from '../utils/appUrl.js';

// The transporter is created lazily (on first use) so that process.env values
// are read AFTER dotenv has loaded the .env file. If the transporter were created
// at module load time, it would see undefined env vars because this module is
// initialized before env.js runs dotenv.config() in the ESM import chain.
let transporter = null;

const getTransporter = () => {
  if (!transporter) {
    const port = Number(process.env.EMAIL_PORT) || 465;
    transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST || 'smtp.gmail.com',
      port,
      secure: port === 465, // true for 465 (SSL), false for 587
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
      tls: {
        rejectUnauthorized: false,
      },
      connectionTimeout: 15000,
    });
  }
  return transporter;
};

/**
 * Verify Mailer connection on server startup.
 * If BREVO_API_KEY is active, skips SMTP verification (Render Free mode over HTTP API).
 * Otherwise verifies Nodemailer SMTP connection (Hostinger VPS / Local mode).
 */
export const connectMailer = async () => {
  if (process.env.BREVO_API_KEY) {
    console.log('[Mailer] Brevo HTTP API mode active. SMTP verification skipped.');
    return;
  }

  // ---------------------------------------------------------------------------
  // [FALLBACK / ORIGINAL NODEMAILER SMTP VERIFICATION]
  // Used for Local Development or when moving to Hostinger VPS (where ports 465/587 are open).
  // ---------------------------------------------------------------------------
  await getTransporter().verify();
  console.log('[Mailer] Nodemailer SMTP connected successfully.');
};

/**
 * Send email verification link to newly registered user.
 * @param {string} to - User's email address
 * @param {string} token - Random verification token (hex string)
 */
export const sendVerificationEmail = async (to, token) => {
  const verifyUrl = `${getAppBaseUrl()}/verify-email?token=${token}`;

  // ===========================================================================
  // [PRIMARY MODE: BREVO HTTP API (Port 443 HTTPS)]
  // Active when BREVO_API_KEY environment variable is set (e.g. Render Free Tier).
  // ===========================================================================
  if (process.env.BREVO_API_KEY) {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': process.env.BREVO_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: {
          name: 'Zuno',
          email: process.env.EMAIL_USER || 'farhan@learnzuno.in',
        },
        to: [{ email: to }],
        subject: 'Zuno — Apna Email Verify Karo',
        htmlContent: `
          <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
            <h2 style="color: #1a1a1a;">Zuno mein aapka swagat hai!</h2>
            <p>Apna account activate karne ke liye neeche diye button par click karo.</p>
            <p>Yeh link <strong>24 ghante</strong> tak valid hai.</p>
            <a href="${verifyUrl}"
               style="display:inline-block; padding:12px 24px; background:#4F46E5;
                      color:#fff; text-decoration:none; border-radius:6px; margin:16px 0;">
              Email Verify Karo
            </a>
            <p style="color:#666; font-size:13px;">
              Agar tumne Zuno par register nahi kiya to is email ko ignore karo.
            </p>
          </div>
        `,
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      console.error('[Brevo Mailer] Verification email send failed:', errData);
      throw new Error(errData.message || 'Verification email sending failed via Brevo.');
    }
    console.log(`[Brevo Mailer] Verification email sent successfully to ${to}`);
    return;
  }

  // ===========================================================================
  // [FALLBACK MODE: NODEMAILER SMTP (GoDaddy / Custom SMTP)]
  // Active when BREVO_API_KEY is not set (e.g. Hostinger VPS or Local Dev).
  // ===========================================================================
  await getTransporter().sendMail({
    from: process.env.EMAIL_FROM || '"Zuno" <farhan@learnzuno.in>',
    to,
    subject: 'Zuno — Apna Email Verify Karo',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #1a1a1a;">Zuno mein aapka swagat hai!</h2>
        <p>Apna account activate karne ke liye neeche diye button par click karo.</p>
        <p>Yeh link <strong>24 ghante</strong> tak valid hai.</p>
        <a href="${verifyUrl}"
           style="display:inline-block; padding:12px 24px; background:#4F46E5;
                  color:#fff; text-decoration:none; border-radius:6px; margin:16px 0;">
          Email Verify Karo
        </a>
        <p style="color:#666; font-size:13px;">
          Agar tumne Zuno par register nahi kiya to is email ko ignore karo.
        </p>
      </div>
    `,
  });
};

/**
 * Send password reset link.
 * @param {string} to - User's email address
 * @param {string} token - Random reset token (hex string)
 */
export const sendPasswordResetEmail = async (to, token) => {
  const resetUrl = `${getAppBaseUrl()}/reset-password?token=${token}`;

  // ===========================================================================
  // [PRIMARY MODE: BREVO HTTP API (Port 443 HTTPS)]
  // Active when BREVO_API_KEY environment variable is set (e.g. Render Free Tier).
  // ===========================================================================
  if (process.env.BREVO_API_KEY) {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': process.env.BREVO_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: {
          name: 'Zuno',
          email: process.env.EMAIL_USER || 'farhan@learnzuno.in',
        },
        to: [{ email: to }],
        subject: 'Zuno — Password Reset Link',
        htmlContent: `
          <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
            <h2 style="color: #1a1a1a;">Password Reset Request</h2>
            <p>Apna password reset karne ke liye neeche diye button par click karo.</p>
            <p>Yeh link <strong>15 minute</strong> tak valid hai.</p>
            <a href="${resetUrl}"
               style="display:inline-block; padding:12px 24px; background:#4F46E5;
                      color:#fff; text-decoration:none; border-radius:6px; margin:16px 0;">
              Password Reset Karo
            </a>
            <p style="color:#666; font-size:13px;">
              Agar tumne yeh request nahi ki to is email ko ignore karo.
              Tumhara account safe hai.
            </p>
          </div>
        `,
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      console.error('[Brevo Mailer] Password reset email send failed:', errData);
      throw new Error(errData.message || 'Password reset email sending failed via Brevo.');
    }
    console.log(`[Brevo Mailer] Password reset email sent successfully to ${to}`);
    return;
  }

  // ===========================================================================
  // [FALLBACK MODE: NODEMAILER SMTP (GoDaddy / Custom SMTP)]
  // Active when BREVO_API_KEY is not set (e.g. Hostinger VPS or Local Dev).
  // ===========================================================================
  await getTransporter().sendMail({
    from: process.env.EMAIL_FROM || '"Zuno" <farhan@learnzuno.in>',
    to,
    subject: 'Zuno — Password Reset Link',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #1a1a1a;">Password Reset Request</h2>
        <p>Apna password reset karne ke liye neeche diye button par click karo.</p>
        <p>Yeh link <strong>15 minute</strong> tak valid hai.</p>
        <a href="${resetUrl}"
           style="display:inline-block; padding:12px 24px; background:#4F46E5;
                  color:#fff; text-decoration:none; border-radius:6px; margin:16px 0;">
          Password Reset Karo
        </a>
        <p style="color:#666; font-size:13px;">
          Agar tumne yeh request nahi ki to is email ko ignore karo.
          Tumhara account safe hai.
        </p>
      </div>
    `,
  });
};

const SUPPORT_NOTIFICATION_EMAIL = 'farhan@learnzuno.in';

const SUPPORT_CATEGORY_LABELS = {
  bug: 'Bug / Problem',
  wrong_answer: 'Wrong Answer',
  feedback: 'Suggestion / Feedback',
  other: 'Other',
};

/**
 * Notify the team inbox when a student submits a support request.
 * Reply-To is set to the student's email so replying from the inbox goes
 * straight to them, not back to the notification address.
 * @param {object} supportRequest - the saved SupportRequest mongoose doc
 */
export const sendSupportNotificationEmail = async (supportRequest) => {
  const { category, subject, description, email, userId, guestId, sessionId, createdAt } = supportRequest;
  const categoryLabel = SUPPORT_CATEGORY_LABELS[category] || category;
  const identity = userId ? `Logged-in user (${userId})` : `Guest (${guestId || 'unknown'})`;

  const htmlBody = `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
      <h2 style="color: #1a1a1a;">New Support Request — ${categoryLabel}</h2>
      <p><strong>Subject:</strong> ${subject}</p>
      <p><strong>Description:</strong><br/>${description.replace(/\n/g, '<br/>')}</p>
      <hr style="border:none; border-top:1px solid #eee; margin:16px 0;" />
      <p style="color:#666; font-size:13px; margin:4px 0;"><strong>From:</strong> ${email}</p>
      <p style="color:#666; font-size:13px; margin:4px 0;"><strong>Identity:</strong> ${identity}</p>
      ${sessionId ? `<p style="color:#666; font-size:13px; margin:4px 0;"><strong>Session:</strong> ${sessionId}</p>` : ''}
      <p style="color:#666; font-size:13px; margin:4px 0;"><strong>Submitted:</strong> ${new Date(createdAt).toLocaleString('en-IN')}</p>
    </div>
  `;

  if (process.env.BREVO_API_KEY) {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': process.env.BREVO_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: { name: 'Zuno Support', email: process.env.EMAIL_USER || 'farhan@learnzuno.in' },
        to: [{ email: SUPPORT_NOTIFICATION_EMAIL }],
        replyTo: { email },
        subject: `[Zuno Support] ${categoryLabel}: ${subject}`,
        htmlContent: htmlBody,
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.message || 'Support notification email failed via Brevo.');
    }
    return;
  }

  await getTransporter().sendMail({
    from: process.env.EMAIL_FROM || '"Zuno" <farhan@learnzuno.in>',
    to: SUPPORT_NOTIFICATION_EMAIL,
    replyTo: email,
    subject: `[Zuno Support] ${categoryLabel}: ${subject}`,
    html: htmlBody,
  });
};
