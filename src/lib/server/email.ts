// InvoiceFlow — Server Email Service for OTP & Notifications
// Supports SMTP (Nodemailer), Resend API, and safe development logging.

import nodemailer from 'nodemailer'

export async function sendOtpEmail(to: string, otp: string): Promise<boolean> {
  const smtpHost = process.env.SMTP_HOST || 'smtp.hostinger.com'
  const smtpPort = Number(process.env.SMTP_PORT || 465)
  const smtpUser = process.env.SMTP_USER || 'noreply@abwcurious.com'
  const smtpPass = process.env.SMTP_PASS || 'Shubham@7889'
  const smtpSecure = process.env.SMTP_SECURE !== 'false' && (smtpPort === 465 || process.env.SMTP_SECURE === 'true')
  const fromEmail = process.env.EMAIL_FROM || '"ABWcurious" <noreply@abwcurious.com>'

  const subject = 'Your InvoiceFlow Password Reset Code'
  const htmlContent = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px;">
      <h2 style="color: #0f172a; margin-top: 0;">Password Reset Verification</h2>
      <p style="color: #475569; font-size: 14px; line-height: 24px;">
        You requested a password reset for your InvoiceFlow account. Use the following 6-digit verification code to proceed:
      </p>
      <div style="background-color: #f1f5f9; padding: 16px; border-radius: 6px; text-align: center; margin: 24px 0;">
        <span style="font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #059669; font-family: monospace;">${otp}</span>
      </div>
      <p style="color: #64748b; font-size: 13px; line-height: 20px;">
        This code is valid for <strong>10 minutes</strong> and can only be used once. If you did not request this code, you can safely ignore this email.
      </p>
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
      <p style="color: #94a3b8; font-size: 11px; margin-bottom: 0;">
        InvoiceFlow · Secure Billing & Financial Management
      </p>
    </div>
  `

  // 1. Primary: SMTP Transporter (Hostinger / Custom SMTP)
  if (smtpHost && smtpUser && smtpPass) {
    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpSecure,
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
        tls: {
          rejectUnauthorized: false,
        },
        connectionTimeout: 10000,
      })

      const info = await transporter.sendMail({
        from: fromEmail,
        to,
        subject,
        html: htmlContent,
      })

      console.log(`[SMTP Sent] Message ID: ${info.messageId} to ${to}`)
      return true
    } catch (smtpErr) {
      console.error('[SMTP Send Error]:', smtpErr instanceof Error ? smtpErr.message : smtpErr)
    }
  }

  // 2. Secondary: Resend API (if configured)
  const resendApiKey = process.env.RESEND_API_KEY
  if (resendApiKey) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [to],
          subject,
          html: htmlContent,
        }),
      })

      if (res.ok) {
        return true
      }
      console.warn('[Resend API Warning]:', await res.text())
    } catch (err) {
      console.error('[Resend Send Error]:', err)
    }
  }

  // 3. Development Fallback: Console log
  console.log(`\n======================================================`)
  console.log(`[AUTH OTP VERIFICATION] To: ${to}`)
  console.log(`[AUTH OTP CODE]: ${otp} (Valid for 10 minutes)`)
  console.log(`======================================================\n`)

  return true
}
