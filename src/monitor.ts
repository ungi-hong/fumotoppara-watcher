import { getAllWatchedDates, updateLastStatus } from './firestore';
import { scrapeAvailability } from './scraper';
import { pushMessage } from './line';
import type { WatchedDateDoc, StatusChange } from './types';

const STATUS_RANK: Record<string, number> = { '×': 0, '△': 1, '○': 2 };

export async function runMonitor(): Promise<void> {
  console.log(`[monitor] 開始: ${new Date().toISOString()}`);

  const watchedDates: WatchedDateDoc[] = await getAllWatchedDates();
  if (watchedDates.length === 0) {
    console.log('[monitor] 監視中の日付なし。終了。');
    return;
  }

  const targetDates = watchedDates.map((d) => d.date);
  console.log(`[monitor] 監視対象 ${targetDates.length} 件:`, targetDates);

  let scraped;
  try {
    scraped = await scrapeAvailability(targetDates);
  } catch (err) {
    console.error('[monitor] スクレイピング失敗:', err);
    process.exit(1);
  }

  const scrapedMap = new Map(scraped.map((s) => [s.date, s.status]));

  const changes: StatusChange[] = [];

  for (const watched of watchedDates) {
    const newStatus = scrapedMap.get(watched.date);
    if (!newStatus) {
      console.warn(`[monitor] ${watched.date} のステータスが取得できませんでした`);
      continue;
    }

    await updateLastStatus(watched.date, newStatus);

    const oldStatus = watched.lastStatus;
    // 初回スキャンですでに空きがある場合も通知
    const shouldNotify =
      (oldStatus === null && newStatus !== '×') || isImprovement(oldStatus, newStatus);

    if (shouldNotify) {
      changes.push({
        date: watched.date,
        oldStatus,
        newStatus,
        users: watched.users,
      });
    }
  }

  for (const change of changes) {
    const message = buildNotificationMessage(change);
    console.log(
      `[monitor] ステータス変化検出: ${change.date} ${change.oldStatus ?? 'null'} → ${change.newStatus}`
    );
    for (const userId of change.users) {
      try {
        await pushMessage(userId, message);
        console.log(`[monitor] 通知送信: ${userId} (${change.date})`);
      } catch (err) {
        console.error(`[monitor] 通知失敗 ${userId}:`, err);
      }
    }
  }

  console.log(`[monitor] 完了。変化 ${changes.length} 件。`);
}

function isImprovement(oldStatus: string | null, newStatus: string): boolean {
  if (oldStatus === null) return false;
  if (oldStatus === newStatus) return false;
  const oldRank = STATUS_RANK[oldStatus] ?? -1;
  const newRank = STATUS_RANK[newStatus] ?? -1;
  return newRank > oldRank;
}

function buildNotificationMessage(change: StatusChange): string {
  const label: Record<string, string> = {
    '○': '○ 空きあり',
    '△': '△ 残りわずか',
    '×': '× 満員',
  };
  const to = label[change.newStatus] ?? change.newStatus;

  // 初回スキャンで空きがある場合
  if (change.oldStatus === null) {
    return [
      '【ふもとっぱら空き通知】',
      `${change.date} は現在 ${to} です！`,
      '',
      '予約はこちら:',
      'https://reserve.fumotoppara.net/',
    ].join('\n');
  }

  const from = label[change.oldStatus] ?? change.oldStatus;
  return [
    '【ふもとっぱら空き通知】',
    `${change.date} の空き状況が変わりました！`,
    `${from} → ${to}`,
    '',
    '予約はこちら:',
    'https://reserve.fumotoppara.net/',
  ].join('\n');
}
