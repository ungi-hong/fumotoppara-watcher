import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifySignature, replyMessage, replyMessages } from '../src/line';
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
    if (isTextMessageEvent(event)) {
      await handleTextCommand(event.source.userId, event.message.text.trim(), event.replyToken);
    } else if (isPostbackEvent(event)) {
      await handlePostback(event.source.userId, event.postback, event.replyToken);
    }
  }

  res.status(200).json({ status: 'ok' });
}

// ── イベント型ガード ──────────────────────────────────────

interface TextMessageEvent {
  type: 'message';
  message: { type: 'text'; text: string };
  source: { userId: string };
  replyToken: string;
}

interface PostbackEvent {
  type: 'postback';
  postback: { data: string; params?: { date?: string } };
  source: { userId: string };
  replyToken: string;
}

function isTextMessageEvent(e: unknown): e is TextMessageEvent {
  const ev = e as Record<string, unknown>;
  return (
    ev.type === 'message' &&
    (ev.message as Record<string, unknown>)?.type === 'text' &&
    typeof (ev.source as Record<string, unknown>)?.userId === 'string'
  );
}

function isPostbackEvent(e: unknown): e is PostbackEvent {
  const ev = e as Record<string, unknown>;
  return (
    ev.type === 'postback' &&
    typeof (ev.source as Record<string, unknown>)?.userId === 'string'
  );
}

// ── テキストコマンド処理 ──────────────────────────────────

async function handleTextCommand(userId: string, text: string, replyToken: string) {
  // "登録" → デートピッカーを表示
  if (text === '登録') {
    await replyWithDatePicker(replyToken);
    return;
  }

  // "解除" → 登録済み日付のクイックリプライを表示
  if (text === '解除') {
    const dates = await listDatesForUser(userId);
    if (dates.length === 0) {
      await replyMessage(replyToken, '監視中の日付はありません。');
      return;
    }
    await replyWithUnregisterPicker(replyToken, dates);
    return;
  }

  // テキスト直打ちにも対応: "登録 YYYY-MM-DD"
  const registerMatch = text.match(/^登録\s+(\d{4}-\d{2}-\d{2})$/);
  if (registerMatch) {
    const date = registerMatch[1];
    if (!isValidFutureDate(date)) {
      await replyMessage(replyToken, `${date} は無効な日付です。未来の日付を指定してください。`);
      return;
    }
    await registerDate(userId, date);
    await replyMessage(replyToken, `✅ ${date} の監視を開始しました。\n× から △ または ○ に変わったときにお知らせします。`);
    return;
  }

  // テキスト直打ち: "解除 YYYY-MM-DD"
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
      await replyMessage(replyToken, '監視中の日付はありません。\n「登録」から日付を追加できます。');
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
        '登録  → 日付を選んで監視開始',
        '解除  → 監視中の日付を選んで解除',
        '一覧  → 監視中の日付を表示',
        'ヘルプ → このメッセージを表示',
        '',
        '× から △ または ○ に変わったときにお知らせします。',
      ].join('\n')
    );
    return;
  }

  await replyMessage(replyToken, '「ヘルプ」と送ると使い方を確認できます。');
}

// ── Postback処理 ─────────────────────────────────────────

async function handlePostback(
  userId: string,
  postback: PostbackEvent['postback'],
  replyToken: string
) {
  const params = new URLSearchParams(postback.data);
  const action = params.get('action');

  if (action === 'register') {
    const date = postback.params?.date;
    if (!date) return;
    await registerDate(userId, date);
    await replyMessage(replyToken, `✅ ${date} の監視を開始しました。\n× から △ または ○ に変わったときにお知らせします。`);
    return;
  }

  if (action === 'unregister') {
    const date = params.get('date');
    if (!date) return;
    await unregisterDate(userId, date);
    await replyMessage(replyToken, `🗑 ${date} の監視を解除しました。`);
    return;
  }
}

// ── ヘルパー ─────────────────────────────────────────────

async function replyWithDatePicker(replyToken: string) {
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const maxStr = `${today.getFullYear() + 1}-12-31`;

  await replyMessages(replyToken, [
    {
      type: 'template',
      altText: '日付を選択してください',
      template: {
        type: 'buttons',
        text: '監視する日付を選択してください',
        actions: [
          {
            type: 'datetimepicker',
            label: '📅 日付を選択',
            data: 'action=register',
            mode: 'date',
            initial: todayStr,
            min: todayStr,
            max: maxStr,
          },
        ],
      },
    },
  ]);
}

async function replyWithUnregisterPicker(replyToken: string, dates: string[]) {
  await replyMessages(replyToken, [
    {
      type: 'text',
      text: '解除する日付を選択してください',
      quickReply: {
        items: dates.slice(0, 13).map((date) => ({
          type: 'action',
          action: {
            type: 'postback',
            label: date,
            data: `action=unregister&date=${date}`,
            displayText: `${date} を解除`,
          },
        })),
      },
    },
  ]);
}

function isValidFutureDate(dateStr: string): boolean {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date >= today;
}
