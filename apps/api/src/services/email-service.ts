import { config } from "../config.js";

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

function webBaseUrl(): string {
  if (config.WEB_BASE_URL) {
    return config.WEB_BASE_URL;
  }

  if (config.CORS_ORIGIN !== "*" && config.CORS_ORIGIN.trim().length > 0) {
    return config.CORS_ORIGIN.split(",")[0].trim();
  }

  return "http://localhost:3000";
}

async function sendBrevoEmail(input: {
  to: string;
  subject: string;
  htmlContent: string;
  textContent: string;
}) {
  if (config.EMAIL_DEV_MODE) {
    console.log(`[EMAIL_DEV_MODE] to=${input.to} subject="${input.subject}"`);
    return;
  }

  if (!config.BREVO_API_KEY) {
    throw new Error("BREVO_API_KEY is required when EMAIL_DEV_MODE=false");
  }

  const response = await fetch(BREVO_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": config.BREVO_API_KEY
    },
    body: JSON.stringify({
      sender: {
        email: "no-reply@synteq.local",
        name: "Synteq"
      },
      to: [{ email: input.to }],
      subject: input.subject,
      textContent: input.textContent,
      htmlContent: input.htmlContent
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Brevo send failed (${response.status}): ${body}`);
  }
}

export async function sendVerificationEmail(input: { email: string; token: string }) {
  const link = `${webBaseUrl()}/verify-email?token=${encodeURIComponent(input.token)}`;
  if (config.EMAIL_DEV_MODE) {
    console.log("Verification link:", link);
    return;
  }

  await sendBrevoEmail({
    to: input.email,
    subject: "Verify your Synteq email",
    textContent: `Verify your email by opening this link: ${link}`,
    htmlContent: `<p>Verify your Synteq email:</p><p><a href="${link}">${link}</a></p>`
  });
}

export async function sendPasswordResetEmail(input: { email: string; token: string }) {
  const link = `${webBaseUrl()}/reset-password?token=${encodeURIComponent(input.token)}`;
  if (config.EMAIL_DEV_MODE) {
    console.log("Password reset link:", link);
    return;
  }

  await sendBrevoEmail({
    to: input.email,
    subject: "Reset your Synteq password",
    textContent: `Reset your password using this link: ${link}`,
    htmlContent: `<p>Reset your Synteq password:</p><p><a href="${link}">${link}</a></p>`
  });
}

export async function sendInviteEmail(input: {
  email: string;
  token: string;
  role: string;
  invitedByName: string;
  tenantName: string;
}) {
  const link = `${webBaseUrl()}/invite/${encodeURIComponent(input.token)}`;
  if (config.EMAIL_DEV_MODE) {
    console.log("Invite link:", link);
    return;
  }

  await sendBrevoEmail({
    to: input.email,
    subject: `You're invited to ${input.tenantName} on Synteq`,
    textContent: `${input.invitedByName} invited you as ${input.role}. Accept invite: ${link}`,
    htmlContent: `<p>${input.invitedByName} invited you to Synteq as <strong>${input.role}</strong>.</p><p><a href="${link}">Accept invite</a></p>`
  });
}

export async function sendIncidentAlert(input: {
  email: string;
  incidentId: string;
  severity: string;
  summary: string;
}) {
  if (config.EMAIL_DEV_MODE) {
    console.log("Incident alert email:", input.email, input.incidentId);
    return;
  }

  await sendBrevoEmail({
    to: input.email,
    subject: `[Synteq][${input.severity.toUpperCase()}] Incident ${input.incidentId}`,
    textContent: input.summary,
    htmlContent: `<p>${input.summary}</p>`
  });
}
