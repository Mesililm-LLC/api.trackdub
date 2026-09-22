import { logger } from "./logger";

/**
 * Thin Resend REST client for transactional email.
 *
 * Uses plain `fetch` — no npm dependency needed in Workers. When no API key
 * is configured, emails are logged but not sent (local dev / CI fallback).
 */

const RESEND_API = "https://api.resend.com/emails";
const FROM_ADDRESS = "Trackdub <noreply@trackdub.com>";

export interface SendPasswordResetParams {
  to: string;
  userName: string | null;
  resetUrl: string;
}

/**
 * Send a password-reset email via Resend. When `apiKey` is absent, logs the
 * reset URL instead (development/staging without mail configured).
 *
 * Never throws — logs and returns on failure so the auth flow is not blocked
 * by mail delivery issues.
 */
export async function sendPasswordResetEmail(
  params: SendPasswordResetParams,
  apiKey: string | undefined,
): Promise<void> {
  if (!apiKey) {
    logger.info("password reset (mail disabled — no RESEND_API_KEY)", {
      to: params.to,
      resetUrl: params.resetUrl,
    });
    return;
  }

  try {
    const response = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [params.to],
        subject: "Reset your Trackdub password",
        html: buildResetEmailHtml(params.userName, params.resetUrl),
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      logger.error("password reset email failed", {
        to: params.to,
        status: response.status,
        body: body.slice(0, 200),
      });
      return;
    }

    logger.info("password reset email sent", { to: params.to });
  } catch (error) {
    logger.error("password reset email threw", {
      to: params.to,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function buildResetEmailHtml(userName: string | null, resetUrl: string): string {
  const greeting = userName ? `Hi ${userName},` : "Hi,";
  return `
<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <p>${greeting}</p>
  <p>We received a request to reset your Trackdub password. Click the button below to choose a new one:</p>
  <p style="margin: 32px 0;">
    <a href="${resetUrl}" style="display: inline-block; padding: 12px 24px; background: #2563eb; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 600;">Reset password</a>
  </p>
  <p style="color: #6b7280; font-size: 14px;">This link expires in 1 hour. If you did not request a reset, you can safely ignore this email.</p>
</body>
</html>`.trim();
}
