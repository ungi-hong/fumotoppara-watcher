import { chromium } from 'playwright';
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

    await page.goto(CALENDAR_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // デバッグ用スクリーンショット（初回DOM確認のために保持）
    if (process.env.DEBUG_SCRAPER) {
      await page.screenshot({ path: 'debug-calendar.png', fullPage: true });
    }

    // カレンダーのロード待機
    await waitForCalendar(page);

    const monthsNeeded = [...new Set(targetDates.map((d) => d.substring(0, 7)))];
    const results: ScrapedDateStatus[] = [];

    for (const yearMonth of monthsNeeded) {
      const [year, month] = yearMonth.split('-').map(Number);
      await navigateToMonth(page, year, month);
      const monthResults = await extractMonthData(page, year, month);
      results.push(...monthResults.filter((r) => targetDates.includes(r.date)));
    }

    return results;
  } finally {
    await browser.close();
  }
}

async function waitForCalendar(page: Page): Promise<void> {
  // 複数のセレクターパターンを試みる（Salesforce LWCのためDOM構造が不定）
  const selectors = [
    '[class*="calendar"]',
    '[class*="Calendar"]',
    'table',
    '.fc-daygrid',
    '[class*="month"]',
  ];

  for (const selector of selectors) {
    try {
      await page.waitForSelector(selector, { timeout: 5000 });
      return;
    } catch {
      // 次のセレクターを試す
    }
  }

  // どのセレクターも見つからない場合は追加待機
  await page.waitForTimeout(3000);
}

async function navigateToMonth(page: Page, year: number, month: number): Promise<void> {
  for (let i = 0; i < 24; i++) {
    const current = await getCurrentDisplayedYearMonth(page);
    if (!current) break;
    if (current.year === year && current.month === month) return;

    const isForward = year * 12 + month > current.year * 12 + current.month;

    // 次/前月ボタンの候補セレクター
    const nextSelectors = [
      '[aria-label*="次"]',
      '[aria-label*="next"]',
      'button.fc-next-button',
      '[title*="次の月"]',
      'button:has-text(">")',
      'button:has-text("▶")',
      'button:has-text("→")',
    ];
    const prevSelectors = [
      '[aria-label*="前"]',
      '[aria-label*="prev"]',
      'button.fc-prev-button',
      '[title*="前の月"]',
      'button:has-text("<")',
      'button:has-text("◀")',
      'button:has-text("←")',
    ];

    const candidates = isForward ? nextSelectors : prevSelectors;
    let clicked = false;

    for (const sel of candidates) {
      try {
        await page.click(sel, { timeout: 3000 });
        clicked = true;
        break;
      } catch {
        // 次のセレクターを試す
      }
    }

    if (!clicked) {
      console.warn(`[scraper] 月ナビゲーションボタンが見つかりません (${year}-${month})`);
      break;
    }

    await page.waitForTimeout(1500);
  }
}

async function getCurrentDisplayedYearMonth(
  page: Page
): Promise<{ year: number; month: number } | null> {
  const headerText = await page.evaluate(() => {
    const candidates = [
      '[class*="calendar-title"]',
      '[class*="calendarTitle"]',
      '.fc-toolbar-title',
      '[class*="month-title"]',
      '[class*="monthTitle"]',
      'h1',
      'h2',
      'h3',
    ].map((s) => document.querySelector(s));

    for (const el of candidates) {
      const text = el?.textContent ?? '';
      if (/\d{4}.*\d{1,2}/.test(text) || /\d{1,2}.*\d{4}/.test(text)) {
        return text;
      }
    }
    return null;
  });

  if (!headerText) return null;

  const match =
    headerText.match(/(\d{4})[年\/\-](\d{1,2})/) ||
    headerText.match(/(\d{1,2})[月\/\-](\d{4})/);
  if (!match) return null;

  // "YYYY年MM月" と "MM月YYYY年" の両形式を処理
  const a = parseInt(match[1]);
  const b = parseInt(match[2]);
  const year = a > 12 ? a : b;
  const month = a > 12 ? b : a;

  return { year, month };
}

async function extractMonthData(
  page: Page,
  year: number,
  month: number
): Promise<ScrapedDateStatus[]> {
  return await page.evaluate(
    ({ year, month }) => {
      const results: { date: string; status: string }[] = [];
      const pad = (n: number) => String(n).padStart(2, '0');

      const parseStatus = (text: string): string | null => {
        if (text.includes('○') || text.includes('〇')) return '○';
        if (text.includes('△')) return '△';
        if (text.includes('×') || text.includes('✕') || text.includes('✗')) return '×';
        return null;
      };

      // 戦略1: data-date 属性を持つセル
      const dateCells = document.querySelectorAll<HTMLElement>('[data-date], [data-day]');
      if (dateCells.length > 0) {
        dateCells.forEach((cell) => {
          const attr = cell.dataset.date ?? cell.dataset.day ?? '';
          if (!attr) return;
          // YYYY-MM-DD 形式、または MM/DD 形式を処理
          let date = attr;
          if (/^\d{1,2}\/\d{1,2}$/.test(attr)) {
            const [m, d] = attr.split('/').map(Number);
            date = `${year}-${pad(m)}-${pad(d)}`;
          }
          const status = parseStatus(cell.textContent ?? '');
          if (status) results.push({ date, status });
        });
        if (results.length > 0) return results;
      }

      // 戦略2: テーブルセルのテキストから日付+ステータスを抽出
      const cells = document.querySelectorAll('td, [class*="day-cell"], [class*="dayCell"], [class*="day_cell"]');
      cells.forEach((cell) => {
        const text = (cell.textContent ?? '').trim();
        const dayMatch = text.match(/^(\d{1,2})\D/);
        if (!dayMatch) return;
        const day = parseInt(dayMatch[1]);
        if (day < 1 || day > 31) return;
        const status = parseStatus(text);
        if (!status) return;
        results.push({ date: `${year}-${pad(month)}-${pad(day)}`, status });
      });

      return results;
    },
    { year, month }
  );
}
