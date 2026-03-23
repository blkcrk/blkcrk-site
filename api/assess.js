export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { submission, assessment } = body;

    if (!submission || !assessment || !submission.name || !submission.email || !submission.message) {
      return res.status(400).json({ ok: false, error: 'Missing required submission fields' });
    }

    const record = {
      receivedAt: new Date().toISOString(),
      submission,
      assessment,
      source: 'blkcrk_assess',
    };

    const webhookUrl = process.env.ASSESS_WEBHOOK_URL;
    const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;

    if (webhookUrl) {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Webhook delivery failed (${response.status}): ${text.slice(0, 300)}`);
      }
    } else if (slackWebhookUrl) {
      const text = [
        '*New Black Creek assessment submission*',
        `*Name:* ${submission.name}`,
        `*Email:* ${submission.email}`,
        `*Company:* ${submission.company || '—'}`,
        `*Website:* ${submission.website || '—'}`,
        `*Bottleneck:* ${assessment.likelyBottleneck}`,
        `*Fit:* ${assessment.fitLabel.toUpperCase()} (${assessment.fitScore}/100)` ,
        `*Urgency:* ${assessment.urgencyScore}/100`,
        `*Next step:* ${assessment.recommendedAction}`,
        `*Message:* ${submission.message}`,
      ].join('\n');

      const response = await fetch(slackWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Slack delivery failed (${response.status}): ${text.slice(0, 300)}`);
      }
    } else {
      console.log('blkcrk_assess_submission', JSON.stringify(record));
      return res.status(503).json({
        ok: false,
        error: 'Submission endpoint is live, but no delivery target is configured yet. Set ASSESS_WEBHOOK_URL or SLACK_WEBHOOK_URL in Vercel project settings.',
      });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('blkcrk_assess_error', error);
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Unexpected server error' });
  }
}
