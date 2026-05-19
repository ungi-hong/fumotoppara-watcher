import * as crypto from 'crypto';
import axios from 'axios';

const LINE_API_BASE = 'https://api.line.me/v2/bot';

function authHeader() {
  return { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` };
}

export function verifySignature(rawBody: Buffer, signature: string): boolean {
  const hmac = crypto.createHmac('sha256', process.env.LINE_CHANNEL_SECRET!);
  hmac.update(rawBody);
  const digest = hmac.digest('base64');
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
}

export async function replyMessage(replyToken: string, text: string): Promise<void> {
  await axios.post(
    `${LINE_API_BASE}/message/reply`,
    { replyToken, messages: [{ type: 'text', text }] },
    { headers: authHeader() }
  );
}

export async function pushMessage(userId: string, text: string): Promise<void> {
  await axios.post(
    `${LINE_API_BASE}/message/push`,
    { to: userId, messages: [{ type: 'text', text }] },
    { headers: authHeader() }
  );
}
