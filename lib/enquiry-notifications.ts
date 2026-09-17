import nodemailer from 'nodemailer';

export type EnquiryNotificationInput = {
  id: string;
  name: string;
  email: string;
  company: string;
  website: string;
  services: string[];
  message: string;
};

const DEFAULT_RECIPIENTS = [
  'ashrafkhanak15@gmail.com',
  'support@presspixelcreations.com',
];

function getRecipients() {
  const configured = process.env.ENQUIRY_NOTIFY_TO?.split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return configured?.length ? configured : DEFAULT_RECIPIENTS;
}

function cleanHeader(value: string) {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

export async function sendEnquiryNotification(data: EnquiryNotificationInput) {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const port = Number(process.env.SMTP_PORT || 465);

  if (!host || !user || !pass) {
    return {
      sent: false as const,
      error: 'SMTP is not configured. Set SMTP_HOST, SMTP_USER and SMTP_PASS.',
    };
  }

  const secure = process.env.SMTP_SECURE
    ? process.env.SMTP_SECURE.toLowerCase() === 'true'
    : port === 465;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    connectionTimeout: 7000,
    greetingTimeout: 7000,
    socketTimeout: 10000,
  });

  const recipients = getRecipients();
  const fromAddress = process.env.ENQUIRY_FROM_EMAIL || user;
  const safeName = cleanHeader(data.name);
  const safeCompany = cleanHeader(data.company);
  const subject = `[PressPixel Enquiry] ${safeName}${safeCompany ? ` — ${safeCompany}` : ''}`;

  const lines = [
    'New website enquiry',
    '',
    `Enquiry ID: ${data.id}`,
    `Name: ${data.name}`,
    `Email: ${data.email}`,
    `Company: ${data.company || 'Not provided'}`,
    `Website: ${data.website || 'Not provided'}`,
    `Services: ${data.services.length ? data.services.join(', ') : 'Not specified'}`,
    '',
    'Message:',
    data.message,
    '',
    'This enquiry was saved to the PressPixel Creations MySQL database before this notification was sent.',
  ];

  try {
    const info = await transporter.sendMail({
      // Keep retries on one stable message ID so mail systems can deduplicate/thread them.
      messageId: `<presspixel-enquiry-${data.id}@presspixelcreations.com>`,
      from: `"PressPixel Website Enquiries" <${fromAddress}>`,
      to: recipients,
      replyTo: data.email,
      subject,
      text: lines.join('\n'),
    });

    return {
      sent: true as const,
      messageId: info.messageId,
      recipients,
    };
  } catch (error) {
    return {
      sent: false as const,
      error: error instanceof Error ? error.message : 'Unknown SMTP error',
    };
  }
}
