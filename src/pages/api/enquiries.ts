import type { APIRoute } from 'astro';
import { enquirySchema } from '../../../lib/enquiry';
import { sendEnquiryNotification } from '../../../lib/enquiry-notifications';
import {
  notificationRetryDelaySeconds,
  notificationWorkerConfig,
} from '../../../lib/enquiry-notification-worker';
import { createEnquiryRateLimit } from '../../../lib/enquiry-rate-limit';
import { recordEnquiryNotificationAttempt, saveEnquiry } from '../../../db/enquiries';

export const prerender = false;

function firstForwardedValue(value: string | null) {
  return value?.split(',')[0]?.trim() || '';
}

function requestPublicHost(request: Request) {
  const forwardedHost = process.env.TRUST_PROXY === 'true'
    ? firstForwardedValue(request.headers.get('x-forwarded-host'))
    : '';
  return (
    forwardedHost ||
    firstForwardedValue(request.headers.get('host')) ||
    new URL(request.url).host
  ).toLowerCase();
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if (!origin || (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'same-site')) {
    return Response.json({ error: 'Please submit the form from this website.' }, { status: 403 });
  }
  try {
    const originHost = new URL(origin).host.toLowerCase();
    if (originHost !== requestPublicHost(request)) {
      return Response.json({ error: 'Please submit the form from this website.' }, { status: 403 });
    }
  } catch {
    return Response.json({ error: 'Please submit the form from this website.' }, { status: 403 });
  }
  if (!request.headers.get('content-type')?.includes('application/json')) return Response.json({ error: 'Please send a valid enquiry.' }, { status: 415 });

  try {
    const body = await request.text();
    if (body.length > 20000) return Response.json({ error: 'Your message is too long.' }, { status: 413 });

    let json: unknown;
    try { json = JSON.parse(body); } catch { return Response.json({ error: 'Please send a valid enquiry.' }, { status: 400 }); }

    const result = enquirySchema.safeParse(json);
    if (!result.success) return Response.json({ error: result.error.issues[0].message }, { status: 400 });
    if (result.data.companyFax) return Response.json({ received: true });

    const rateLimit = createEnquiryRateLimit(request, clientAddress, result.data.email);
    const outcome = await saveEnquiry(result.data, rateLimit);
    if (outcome.limited) return Response.json({ error: 'You’ve already sent several enquiries. Please email support@presspixelcreations.com if you need to add anything.' }, { status: 429 });

    // Do not notify again if the browser retries the same enquiry ID.
    if (!outcome.duplicate) {
      const notification = await sendEnquiryNotification(result.data);

      try {
        const { maxAttempts } = notificationWorkerConfig();
        const exhausted = !notification.sent && maxAttempts <= 1;
        const nextAttemptAt = notification.sent || exhausted
          ? undefined
          : new Date(Date.now() + notificationRetryDelaySeconds(1) * 1000);
        await recordEnquiryNotificationAttempt(
          result.data.id,
          notification.sent,
          1,
          notification.sent ? undefined : notification.error,
          nextAttemptAt,
        );
      } catch (statusError) {
        console.error('Could not record enquiry notification status:', statusError instanceof Error ? statusError.message : 'Unknown error');
      }

      if (!notification.sent) {
        console.error(`Enquiry ${result.data.id} was saved, but email notification failed and was queued for retry: ${notification.error}`);
      }
    }

    return Response.json({ received: true }, { status: 201 });
  } catch (error) {
    console.error('Enquiry save failed:', error instanceof Error ? error.message : 'Unknown error');
    return Response.json({ error: 'We couldn’t save your enquiry. Your details are still here; please try again or email support@presspixelcreations.com.' }, { status: 503 });
  }
};
