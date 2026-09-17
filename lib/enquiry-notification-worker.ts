import {
  claimPendingEnquiryNotifications,
  recordEnquiryNotificationAttempt,
} from '../db/enquiries';
import { sendEnquiryNotification } from './enquiry-notifications';

function positiveInteger(name: string, fallback: number, minimum: number, maximum: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

export function notificationWorkerConfig() {
  return {
    maxAttempts: positiveInteger('ENQUIRY_NOTIFICATION_MAX_ATTEMPTS', 6, 1, 20),
    batchSize: positiveInteger('ENQUIRY_NOTIFICATION_BATCH_SIZE', 5, 1, 50),
    leaseSeconds: positiveInteger('ENQUIRY_NOTIFICATION_LEASE_SECONDS', 600, 60, 3600),
  };
}

export function notificationRetryDelaySeconds(attemptNumber: number) {
  const schedule = [300, 900, 3600, 14_400, 43_200, 86_400];
  return schedule[Math.min(Math.max(attemptNumber - 1, 0), schedule.length - 1)];
}

export async function retryPendingEnquiryNotifications() {
  const config = notificationWorkerConfig();
  const pending = await claimPendingEnquiryNotifications(
    config.batchSize,
    config.maxAttempts,
    config.leaseSeconds,
  );
  const summary = { claimed: pending.length, sent: 0, failed: 0, exhausted: 0 };

  for (const enquiry of pending) {
    const notification = await sendEnquiryNotification(enquiry);
    const exhausted = !notification.sent && enquiry.attemptNumber >= config.maxAttempts;
    const nextAttemptAt = notification.sent || exhausted
      ? undefined
      : new Date(Date.now() + notificationRetryDelaySeconds(enquiry.attemptNumber) * 1000);

    await recordEnquiryNotificationAttempt(
      enquiry.id,
      notification.sent,
      enquiry.attemptNumber,
      notification.sent ? undefined : notification.error,
      nextAttemptAt,
    );

    if (notification.sent) {
      summary.sent += 1;
    } else {
      summary.failed += 1;
      if (exhausted) {
        summary.exhausted += 1;
        console.error(`Enquiry ${enquiry.id} notification exhausted ${config.maxAttempts} attempts: ${notification.error}`);
      } else {
        console.warn(`Enquiry ${enquiry.id} notification attempt ${enquiry.attemptNumber} failed: ${notification.error}`);
      }
    }
  }

  return summary;
}
