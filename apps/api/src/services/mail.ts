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
         <p>Thanks for joining our pothole submission platform. Your account is <b>awaiting approval</b> — we will email you as soon as an admin reviews it, and you can then start submitting pothole reports.</p>`,
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
         <p>Your account has been <b>approved</b>. Open the app and start submitting pothole photos and videos — every report helps map and fix our roads.</p>`,
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

  /** amountInr null = non-collector (voluntary submission, no money copy). */
  sampleAccepted: (to: string, fullName: string, sampleId: string, amountInr: number | null) =>
    send(
      to,
      amountInr == null
        ? `${APP_NAME}: submission accepted`
        : `${APP_NAME}: sample accepted — ₹${amountInr} added`,
      layout(
        amountInr == null ? 'Submission accepted' : 'Sample accepted',
        amountInr == null
          ? `<p>Hi ${fullName},</p>
             <p>Your pothole submission <code>${sampleId}</code> was <b>accepted</b> — thank you for helping map and fix our roads!</p>`
          : `<p>Hi ${fullName},</p>
             <p>Your sample <code>${sampleId}</code> was <b>accepted</b> and <b>₹${amountInr}</b> was added to your earnings. It unlocks for withdrawal when the track's quota completes.</p>`,
      ),
    ),

  /** amountInr null = non-collector (voluntary submission, no money copy). */
  samplePartiallyAccepted: (to: string, fullName: string, sampleId: string, amountInr: number | null) =>
    send(
      to,
      amountInr == null
        ? `${APP_NAME}: submission accepted with adjustments`
        : `${APP_NAME}: sample accepted with adjustments — ₹${amountInr} added`,
      layout(
        'Accepted with adjustments',
        amountInr == null
          ? `<p>Hi ${fullName},</p>
             <p>Your pothole submission <code>${sampleId}</code> was <b>accepted</b> after the reviewer adjusted some of its annotations — thank you for contributing!</p>`
          : `<p>Hi ${fullName},</p>
             <p>Your sample <code>${sampleId}</code> was <b>accepted</b> after the reviewer adjusted some of its annotations. <b>₹${amountInr}</b> was added to your earnings and unlocks when the track's quota completes.</p>`,
      ),
    ),

  collectorDesignated: (to: string, fullName: string, planName: string) =>
    send(
      to,
      `${APP_NAME}: you are now a collector`,
      layout(
        'Welcome aboard as a collector!',
        `<p>Hi ${fullName},</p>
         <p>You are now a <b>collector</b> on the <b>${planName}</b> plan. Accepted photos and videos accrue earnings per sample; each media track's earnings unlock for withdrawal when you complete its quota.</p>`,
      ),
    ),

  withdrawalRequested: (collectorName: string, amountInr: number, upiId: string) =>
    send(
      config.adminEmail,
      `${APP_NAME}: withdrawal request — ₹${amountInr}`,
      layout(
        'New withdrawal request',
        `<p><b>${collectorName}</b> requested a withdrawal of <b>₹${amountInr}</b> to UPI <code>${upiId}</code>.</p>
         <p>Review it in the admin console.</p>`,
      ),
    ),

  withdrawalApproved: (to: string, fullName: string, amountInr: number) =>
    send(
      to,
      `${APP_NAME}: withdrawal approved`,
      layout(
        'Withdrawal approved',
        `<p>Hi ${fullName},</p>
         <p>Your withdrawal of <b>₹${amountInr}</b> was approved and the payout is being processed.</p>`,
      ),
    ),

  withdrawalRejected: (to: string, fullName: string, amountInr: number, note: string) =>
    send(
      to,
      `${APP_NAME}: withdrawal update`,
      layout(
        'Withdrawal rejected',
        `<p>Hi ${fullName},</p>
         <p>Your withdrawal request of <b>₹${amountInr}</b> was rejected.</p>
         <p><b>Note:</b> ${note || 'Not specified'}</p>`,
      ),
    ),

  withdrawalPaid: (to: string, fullName: string, amountInr: number, utr: string | null) =>
    send(
      to,
      `${APP_NAME}: ₹${amountInr} paid`,
      layout(
        'Withdrawal paid',
        `<p>Hi ${fullName},</p>
         <p>Your withdrawal of <b>₹${amountInr}</b> has been paid to your UPI.</p>
         ${utr ? `<p><b>UTR reference:</b> ${utr}</p>` : ''}`,
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
