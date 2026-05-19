import { chromium, type Page } from 'playwright';
import * as fs from 'fs';
import type { ScrapedDateStatus } from './types';

const CALENDAR_URL =
  'https://reserve.fumotoppara.net/reserved/reserved-calendar-list';

export async function scrapeAvailability(
  targetDates: string[]
): Promise<ScrapedDateStatus[]> {
  if (targetDates.length === 0) return [];

  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
      locale: 'ja-JP',
    });
    const page = await context.newPage();

    // networkidle でJSレンダリング完了まで待つ
    await page.goto(CALENDAR_URL, { waitUntil: 'networkidle', timeout: 30000 });

    // カレンダーのテーブルが現れるまで待機
    await page.waitForSelector('table', { timeout: 15000 });
    // データセルの描画を待つ
    await page.waitForTimeout(2000);

    if (process.env.DEBUG_SCRAPER) {
      await page.screenshot({ path: 'debug-calendar.png', fullPage: true });
      fs.writeFileSync('debug-calendar.html', await page.content(), 'utf-8');
    }

    // 監視対象の年月ごとにナビゲートしてデータ取得
    const monthsNeeded = [...new Set(targetDates.map((d) => d.substring(0, 7)))];
    const results: ScrapedDateStatus[] = [];

    for (const yearMonth of monthsNeeded) {
      const [year, month] = yearMonth.split('-').map(Number);
      await navigateToMonth(page, year, month);
      const monthResults = await extractCalendarData(page, year);
      results.push(...monthResults.filter((r) => targetDates.includes(r.date)));
    }

    return results;
  } finally {
    await browser.close();
  }
}

// 月ボタン（5月, 6月...）をクリックして対象月を表示する
async function navigateToMonth(page: Page, year: number, month: number): Promise<void> {
  // まず対象月のボタンをクリック（例: "6月"）
  const monthLabel = `${month}月`;
  try {
    await page.click(`button:has-text("${monthLabel}"), a:has-text("${monthLabel}")`, {
      timeout: 5000,
    });
    await page.waitForTimeout(1500);
    return;
  } catch {
    // 月ボタンが見つからない場合は > ボタンで進む
  }

  // > ボタンで前後にナビゲート
  for (let i = 0; i < 12; i++) {
    const visible = await isTargetDateVisible(page, year, month);
    if (visible) return;

    try {
      // カレンダー上部の > ボタン
      await page.click('button:has-text(">")', { timeout: 3000 });
      await page.waitForTimeout(1500);
    } catch {
      break;
    }
  }
}

// 対象の年月のセルがカレンダー上に見えているか確認
async function isTargetDateVisible(page: Page, year: number, month: number): Promise<boolean> {
  return await page.evaluate(
    ({ month }: { year: number; month: number }) => {
      const allText = document.body.innerText;
      // "M/1" や "M/01" 形式で月初のセルが見えているか
      return allText.includes(`${month}/1`) || allText.includes(`${month}/01`);
    },
    { year, month }
  );
}

// カレンダーテーブルをパースして全日付のステータスを返す
// 構造: ヘッダー行に "M/D" 形式の日付、データ行に ×/○/△/残N
async function extractCalendarData(page: Page, year: number): Promise<ScrapedDateStatus[]> {
  return await page.evaluate(
    ({ year }: { year: number }) => {
      const results: { date: string; status: string }[] = [];
      const pad = (n: number) => String(n).padStart(2, '0');
      const statusRank: Record<string, number> = { '○': 2, '△': 1, '×': 0 };

      const parseStatus = (text: string): string | null => {
        const t = text.trim();
        if (t.includes('○') || t.includes('〇')) return '○';
        if (t.includes('△')) return '△';
        if (/残\d/.test(t)) return '△'; // 残N枠 = △扱い
        if (t.includes('×') || t.includes('✕')) return '×';
        return null;
      };

      // 全テーブル行を取得
      const rows = Array.from(document.querySelectorAll('tr'));
      if (rows.length === 0) return results;

      // ヘッダー行: "M/D" 形式のセルが最も多い行
      let headerRow: Element | null = null;
      let maxDateCells = 0;
      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll('td, th'));
        const count = cells.filter((c) => /^\d{1,2}\/\d{1,2}/.test((c.textContent ?? '').trim())).length;
        if (count > maxDateCells) {
          maxDateCells = count;
          headerRow = row;
        }
      }
      if (!headerRow || maxDateCells === 0) return results;

      // 列インデックス → YYYY-MM-DD のマップを作成
      const headerCells = Array.from(headerRow.querySelectorAll('td, th'));
      const colToDate = new Map<number, string>();
      const today = new Date();

      headerCells.forEach((cell, colIdx) => {
        const text = (cell.textContent ?? '').trim();
        const m = text.match(/^(\d{1,2})\/(\d{1,2})/);
        if (!m) return;
        const cellMonth = parseInt(m[1]);
        const cellDay = parseInt(m[2]);
        // 年の推定: 現在月±6ヶ月の範囲で判断
        let cellYear = year;
        if (cellMonth < today.getMonth() + 1 - 6) cellYear = year + 1;
        if (cellMonth > today.getMonth() + 1 + 6) cellYear = year - 1;
        colToDate.set(colIdx, `${cellYear}-${pad(cellMonth)}-${pad(cellDay)}`);
      });

      if (colToDate.size === 0) return results;

      // データ行を走査して日付ごとに最良ステータスを集計
      const bestStatus = new Map<string, string>();
      const dataRows = rows.filter((r) => r !== headerRow);

      for (const row of dataRows) {
        const cells = Array.from(row.querySelectorAll('td, th'));
        cells.forEach((cell, colIdx) => {
          const date = colToDate.get(colIdx);
          if (!date) return;
          const status = parseStatus(cell.textContent ?? '');
          if (!status) return;
          const current = bestStatus.get(date);
          if (!current || (statusRank[status] ?? -1) > (statusRank[current] ?? -1)) {
            bestStatus.set(date, status);
          }
        });
      }

      bestStatus.forEach((status, date) => results.push({ date, status }));
      return results;
    },
    { year }
  );
}
