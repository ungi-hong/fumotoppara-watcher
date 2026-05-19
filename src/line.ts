import * as crypto from 'crypto';

const LINE_API_BASE = 'https://api.line.me/v2/bot';

function authHeader() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
  };
}

async function linePost(url: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeader(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LINE API error ${res.status}: ${text}`);
  }
}

export function verifySignature(rawBody: Buffer, signature: string): boolean {
  const hmac = crypto.createHmac('sha256', process.env.LINE_CHANNEL_SECRET!);
  hmac.update(rawBody);
  const digest = hmac.digest('base64');
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
}

export async function replyMessage(replyToken: string, text: string): Promise<void> {
  await linePost(`${LINE_API_BASE}/message/reply`, {
    replyToken,
    messages: [{ type: 'text', text }],
  });
}

export async function pushMessage(userId: string, text: string): Promise<void> {
  await linePost(`${LINE_API_BASE}/message/push`, {
    to: userId,
    messages: [{ type: 'text', text }],
  });
}
