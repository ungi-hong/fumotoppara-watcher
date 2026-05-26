const CRONJOB_API_BASE = 'https://api.cron-job.org';

export async function setJobEnabled(enabled: boolean): Promise<void> {
  const apiKey = process.env.CRONJOB_API_KEY;
  const jobId = process.env.CRONJOB_JOB_ID;

  if (!apiKey || !jobId) {
    console.warn('[cron-job] CRONJOB_API_KEY または CRONJOB_JOB_ID が未設定。スキップ。');
    return;
  }

  try {
    const res = await fetch(`${CRONJOB_API_BASE}/jobs/${jobId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ job: { enabled } }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[cron-job] enabled=${enabled} 失敗: ${res.status} ${text}`);
      return;
    }

    console.log(`[cron-job] enabled=${enabled} 成功`);
  } catch (err) {
    console.error(`[cron-job] enabled=${enabled} 例外:`, err);
  }
}
