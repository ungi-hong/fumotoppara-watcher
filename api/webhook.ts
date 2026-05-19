import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifySignature, replyMessage } from '../src/line';
import { registerDate, unregisterDate, listDatesForUser } from '../src/firestore';

export const config = {
  api: { bodyParser: false },
};

async function getRawBody(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const rawBody = await getRawBody(req);
  const signature = req.headers['x-line-signature'] as string;

  if (!signature || !verifySignature(rawBody, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const body = JSON.parse(rawBody.toString('utf-8'));
  const events: unknown[] = body.events ?? [];

  for (const event of events) {
    if (!isTextMessageEvent(event)) continue;
    await handleCommand(event.source.userId, event.message.text.trim(), event.replyToken);
  }

  res.status(200).json({ status: 'ok' });
}

interface TextMessageEvent {
  type: 'message';
  message: { type: 'text'; text: string };
  source: { userId: string };
  replyToken: string;
}

function isTextMessageEvent(event: unknown): event is TextMessageEvent {
  const e = event as Record<string, unknown>;
  return (
    e.type === 'message' &&
    typeof e.replyToken === 'string' &&
    (e.message as Record<string, unknown>)?.type === 'text' &&
    typeof (e.source as Record<string, unknown>)?.userId === 'string'
  );
}

async function handleCommand(userId: string, text: string, replyToken: string) {
  const registerMatch = text.match(/^登録\s+(\d{4}-\d{2}-\d{2})$/);
  if (registerMatch) {
    const date = registerMatch[1];
    if (!isValidFutureDate(date)) {
      await replyMessage(replyToken, `${date} は無効な日付です。YYYY-MM-DD 形式で未来の日付を指定してください。`);
      return;
    }
    await registerDate(userId, date);
    await replyMessage(replyToken, `✅ ${date} の空き状況の監視を開始しました。\n× から △ または ○ に変わったときにお知らせします。`);
    return;
  }

  const unregisterMatch = text.match(/^解除\s+(\d{4}-\d{2}-\d{2})$/);
  if (unregisterMatch) {
    const date = unregisterMatch[1];
    await unregisterDate(userId, date);
    await replyMessage(replyToken, `🗑 ${date} の監視を解除しました。`);
    return;
  }

  if (text === '一覧') {
    const dates = await listDatesForUser(userId);
    if (dates.length === 0) {
      await replyMessage(replyToken, '監視中の日付はありません。\n「登録 YYYY-MM-DD」で日付を登録できます。');
    } else {
      await replyMessage(replyToken, `📋 監視中の日付 (${dates.length}件):\n${dates.join('\n')}`);
    }
    return;
  }

  if (text === 'ヘルプ' || text.toLowerCase() === 'help') {
    await replyMessage(
      replyToken,
      [
        '【ふもとっぱら空き通知ボット】',
        '',
        '登録 YYYY-MM-DD  → 日付を監視開始',
        '解除 YYYY-MM-DD  → 日付の監視を解除',
        '一覧              → 監視中の日付を表示',
        'ヘルプ            → このメッセージを表示',
        '',
        '× から △ または ○ に変わったときにお知らせします。',
      ].join('\n')
    );
    return;
  }

  await replyMessage(replyToken, '「ヘルプ」と送ると使い方を確認できます。');
}

function isValidFutureDate(dateStr: string): boolean {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date >= today;
}
