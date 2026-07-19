/**
 * Transactional mail via Resend. If RESEND_API_KEY is unset every send is a
 * logged no-op, so local development never blocks on mail.
 */
import { Resend } from 'resend';
import { APP_NAME, POWERED_BY } from '@pothole/shared';
import { config } from '../config';

let client: Resend | null | undefined;

function getClient(): Resend | null {
  if (client !== undefined) return client;
  client = config.resendApiKey ? new Resend(config.resendApiKey) : null;
  if (!client) console.warn('[mail] RESEND_API_KEY not set — emails will be logged and skipped');
  return client;
}

async function send(to: string, subject: string, html: string): Promise<void> {
  if (!to) return;
  const resend = getClient();
  if (!resend) {
    console.log(`[mail] (skipped) to=${to} subject="${subject}"`);
    return;
  }
  try {
    await resend.emails.send({ from: config.mailFrom, to, subject, html });
    console.log(`[mail] sent to=${to} subject="${subject}"`);
  } catch (err) {
    // Mail failures must never fail the request.
    console.error('[mail] send failed:', (err as Error).message);
  }
}

const layout = (title: string, body: string) => `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a1a1a">
    <h2 style="color:#0f766e;margin-bottom:4px">${APP_NAME}</h2>
    <h3 style="margin-top:0">${title}</h3>
    ${body}
    <hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0"/>
    <p style="font-size:12px;color:#777">Powered by ${POWERED_BY}</p>
  </div>`;

export const mail = {
  signupReceived: (to: string, fullName: string) =>
    send(
      to,
      `${APP_NAME}: signup received`,
      layout(
        'Thanks for signing up!',
        `<p>Hi ${fullName},</p>
         <p>Your account is <b>awaiting approval</b>. We will email you as soon as an admin reviews it — you can then start collecting pothole samples.</p>`,
      ),
    ),

  newSignupAdminAlert: (fullName: string, email: string, collectorStatus: string) =>
    send(
      config.adminEmail,
      `${APP_NAME}: new signup awaiting approval`,
      layout(
        'New signup awaiting approval',
        `<p><b>${fullName}</b> (${email}) signed up as <b>${collectorStatus}</b>.</p>
         <p>Please review and approve or reject the account in the admin console.</p>`,
      ),
    ),

  accountApproved: (to: string, fullName: string) =>
    send(
      to,
      `${APP_NAME}: account approved`,
      layout(
        'Your account is approved',
        `<p>Hi ${fullName},</p>
         <p>Your account has been <b>approved</b>. Open the app and start collecting pothole photos and videos to earn.</p>`,
      ),
    ),

  accountRejected: (to: string, fullName: string, reason: string) =>
    send(
      to,
      `${APP_NAME}: account update`,
      layout(
        'Your account was not approved',
        `<p>Hi ${fullName},</p>
         <p>Unfortunately your signup was rejected.</p>
         <p><b>Reason:</b> ${reason || 'Not specified'}</p>`,
      ),
    ),

  sampleAccepted: (to: string, fullName: string, sampleId: string, amountInr: number) =>
    send(
      to,
      `${APP_NAME}: sample accepted — ₹${amountInr} credited`,
      layout(
        'Sample accepted',
        `<p>Hi ${fullName},</p>
         <p>Your sample <code>${sampleId}</code> was <b>accepted</b> and <b>₹${amountInr}</b> has been credited to your balance.</p>`,
      ),
    ),

  samplePartiallyAccepted: (to: string, fullName: string, sampleId: string, amountInr: number) =>
    send(
      to,
      `${APP_NAME}: sample accepted with adjustments — ₹${amountInr} credited`,
      layout(
        'Sample accepted with adjustments',
        `<p>Hi ${fullName},</p>
         <p>Your sample <code>${sampleId}</code> was <b>accepted</b> after the reviewer adjusted some of its annotations. <b>₹${amountInr}</b> has been credited to your balance.</p>`,
      ),
    ),

  packageComplete: (to: string, fullName: string, packageName: string, payoutInr: number, nextPackageName: string | null) =>
    send(
      to,
      `${APP_NAME}: package complete — ₹${payoutInr} earned`,
      layout(
        'Package complete!',
        `<p>Hi ${fullName},</p>
         <p>You completed the <b>${packageName}</b> package and earned <b>₹${payoutInr}</b>. Great work!</p>
         ${nextPackageName ? `<p>Your next package, <b>${nextPackageName}</b>, has started automatically.</p>` : ''}`,
      ),
    ),

  sampleRejected: (to: string, fullName: string, sampleId: string, reason: string) =>
    send(
      to,
      `${APP_NAME}: sample rejected`,
      layout(
        'Sample rejected',
        `<p>Hi ${fullName},</p>
         <p>Your sample <code>${sampleId}</code> was <b>rejected</b>.</p>
         <p><b>Reason:</b> ${reason || 'Not specified'}</p>
         <p>This decision is final for this sample — please capture and upload a new sample.</p>`,
      ),
    ),

  settlementCompleted: (to: string, fullName: string, amountInr: number, utr: string | null) =>
    send(
      to,
      `${APP_NAME}: ₹${amountInr} settled`,
      layout(
        'Payout settled',
        `<p>Hi ${fullName},</p>
         <p><b>₹${amountInr}</b> has been paid out to your UPI.</p>
         ${utr ? `<p><b>UTR reference:</b> ${utr}</p>` : ''}`,
      ),
    ),
};
