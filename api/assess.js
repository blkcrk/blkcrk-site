function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

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

    const resendApiKey = process.env.RESEND_API_KEY;
    const toEmail = process.env.ASSESS_TO_EMAIL || 'cs.miller@blkcrk.com';
    const fromEmail = process.env.ASSESS_FROM_EMAIL || 'Black Creek Assess <onboarding@resend.dev>';
    const webhookUrl = process.env.ASSESS_WEBHOOK_URL;
    const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;

    if (resendApiKey) {
      const html = `
        <h2>New Black Creek assessment submission</h2>
        <p><strong>Name:</strong> ${escapeHtml(submission.name)}</p>
        <p><strong>Email:</strong> ${escapeHtml(submission.email)}</p>
        <p><strong>Company:</strong> ${escapeHtml(submission.company || '—')}</p>
        <p><strong>Website:</strong> ${escapeHtml(submission.website || '—')}</p>
        <p><strong>Bottleneck:</strong> ${escapeHtml(assessment.likelyBottleneck || '—')}</p>
        <p><strong>Fit:</strong> ${escapeHtml(String(assessment.fitLabel || '').toUpperCase())} (${escapeHtml(String(assessment.fitScore ?? '—'))}/100)</p>
        <p><strong>Urgency:</strong> ${escapeHtml(String(assessment.urgencyScore ?? '—'))}/100</p>
        <p><strong>Recommended next step:</strong> ${escapeHtml(assessment.recommendedAction || '—')}</p>
        <p><strong>Message:</strong></p>
        <pre style="white-space:pre-wrap;font:inherit">${escapeHtml(submission.message)}</pre>
      `;

      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${resendApiKey}`,
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [toEmail],
          reply_to: submission.email,
          subject: `New assessment: ${submission.name}${submission.company ? ` @ ${submission.company}` : ''}`,
          html,
        }),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Resend delivery failed (${response.status}): ${text.slice(0, 300)}`);
      }
    } else if (webhookUrl) {
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
        error: 'Submission endpoint is live, but no delivery target is configured yet. Set RESEND_API_KEY (preferred) or ASSESS_WEBHOOK_URL / SLACK_WEBHOOK_URL in Vercel project settings.',
      });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('blkcrk_assess_error', error);
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Unexpected server error' });
  }
}
