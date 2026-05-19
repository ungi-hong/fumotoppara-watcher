import * as dotenv from 'dotenv';
dotenv.config();

import { runMonitor } from '../src/monitor';

runMonitor().catch((err) => {
  console.error('[run-monitor] 致命的なエラー:', err);
  process.exit(1);
});
