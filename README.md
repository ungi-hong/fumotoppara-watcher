# fumotoppara-watcher

ふもとっぱらキャンプ場の予約空き状況を監視し、空きが出たら LINE に通知する Bot です。

## 概要

[ふもとっぱら予約サイト](https://reserve.fumotoppara.net/reserved/reserved-calendar-list) のカレンダーを定期的にスクレイピングし、**キャンプ宿泊**の空き状況が `×`（満員）から `△`（残りわずか）または `○`（空きあり）に変化したタイミングで LINE に通知します。

通知を受け取ったユーザーはその日付の監視リストから自動で削除されます。

## 機能

- LINE Bot からカレンダー UI で監視日付を登録・解除
- 5 分ごとにスクレイピングして空き状況を監視
- 空きが出たら LINE Push 通知
- 通知後は自動で監視解除
- 登録時点ですでに空きがある場合も即通知

## アーキテクチャ

```
ユーザー (LINE)
  │  登録・解除・一覧
  ▼
LINE Messaging API
  │ Webhook
  ▼
Vercel (api/webhook.ts)       ← LINE からのメッセージを処理
  │ Firestore 読み書き
  ▼
Firebase Firestore             ← 監視日付・ユーザー情報を保存

cron-job.org (5分ごと)
  │ workflow_dispatch 起動
  ▼
GitHub Actions (monitor.yml)
  │
  ▼
Playwright + Chromium          ← ふもとっぱらサイトをスクレイピング
  │ 空き変化を検出
  ▼
LINE Messaging API (Push)      ← 通知送信
```

## 使用技術

| 用途 | 技術 |
|---|---|
| サーバーレス API | Vercel (Node.js) |
| LINE Bot | LINE Messaging API / `@line/bot-sdk` |
| スクレイピング | Playwright (Chromium) |
| データベース | Firebase Firestore |
| スケジューリング | cron-job.org → GitHub Actions (workflow_dispatch) |
| 言語 | TypeScript |

## コマンド一覧 (LINE)

| コマンド | 動作 |
|---|---|
| `登録` | カレンダーから日付を選んで監視開始 |
| `解除` | 監視中の日付を選んで解除 |
| `一覧` | 監視中の日付を表示 |
| `ヘルプ` | 使い方を表示 |

## 環境変数

| 変数名 | 説明 |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Firebase サービスアカウント JSON |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE チャンネルアクセストークン |
| `LINE_CHANNEL_SECRET` | LINE チャンネルシークレット |
