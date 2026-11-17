import nodemailer from 'nodemailer';
import { config } from '../config';

export function isPasswordResetEmailConfigured(): boolean {
  return !!(
    config.smtpHost &&
    config.smtpUser &&
    config.smtpPassword &&
    config.smtpFrom
  );
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  if (!isPasswordResetEmailConfigured()) {
    throw new Error('Password reset email is not configured');
  }

  const resetUrl = new URL('/login', config.appOrigin);
  resetUrl.searchParams.set('resetToken', token);

  const transport = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth: {
      user: config.smtpUser,
      pass: config.smtpPassword,
    },
  });

  try {
    await transport.sendMail({
      from: config.smtpFrom,
      to,
      subject: 'Reset your School ERP password',
      text: [
        'A password reset was requested for your School ERP account.',
        '',
        `Use this single-use link within 30 minutes: ${resetUrl.toString()}`,
        '',
        'If you did not request this, ignore this email. Your password will not change.',
      ].join('\n'),
      html: `<p>A password reset was requested for your School ERP account.</p><p><a href="${escapeHtml(resetUrl.toString())}">Reset your password</a></p><p>This single-use link expires in 30 minutes. If you did not request it, ignore this email; your password will not change.</p>`,
    });
  } finally {
    transport.close();
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]!);
}
