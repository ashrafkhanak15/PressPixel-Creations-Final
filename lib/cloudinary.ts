import { createHash } from 'node:crypto';

const DEFAULT_FOLDER = 'presspixel-creations/journal';

export type CloudinaryUploadSignature = {
  cloudName: string;
  apiKey: string;
  folder: string;
  timestamp: number;
  signature: string;
};

function value(name: string) {
  return process.env[name]?.trim() || '';
}

function validCloudName(value: string) {
  return /^[a-z0-9_-]{1,100}$/i.test(value);
}

function validFolder(value: string) {
  return /^[a-z0-9][a-z0-9_/-]{0,200}$/i.test(value) && !value.includes('//') && !value.includes('..');
}

function config() {
  const cloudName = value('CLOUDINARY_CLOUD_NAME');
  const apiKey = value('CLOUDINARY_API_KEY');
  const apiSecret = value('CLOUDINARY_API_SECRET');
  const folder = value('CLOUDINARY_JOURNAL_FOLDER') || DEFAULT_FOLDER;
  if (!validCloudName(cloudName) || !apiKey || apiSecret.length < 16 || !validFolder(folder)) {
    throw new Error('Cloudinary image uploads are not configured.');
  }
  return { cloudName, apiKey, apiSecret, folder };
}

export function cloudinaryUploadsAvailable() {
  try {
    config();
    return true;
  } catch {
    return false;
  }
}

export function createCloudinaryUploadSignature(): CloudinaryUploadSignature {
  const { cloudName, apiKey, apiSecret, folder } = config();
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHash('sha1')
    .update(`folder=${folder}&timestamp=${timestamp}${apiSecret}`)
    .digest('hex');
  return { cloudName, apiKey, folder, timestamp, signature };
}

export function isExpectedCloudinaryImage(input: {
  publicId: string;
  url: string;
  width: number;
  height: number;
}) {
  const { cloudName, folder } = config();
  if (!input.publicId.startsWith(`${folder}/`) || !/^[\w/-]{1,255}$/.test(input.publicId)) return false;
  if (!Number.isInteger(input.width) || !Number.isInteger(input.height) || input.width < 1 || input.height < 1 || input.width > 20_000 || input.height > 20_000) return false;
  try {
    const url = new URL(input.url);
    return url.protocol === 'https:' && url.hostname === 'res.cloudinary.com' && url.pathname.startsWith(`/${cloudName}/image/upload/`);
  } catch {
    return false;
  }
}
