type Urgency = 'urgent' | 'average' | 'normal' | 'warning';

async function getConfig(DB: D1Database, key: string): Promise<string | null> {
  const row = await DB.prepare('SELECT value FROM config WHERE key = ?').bind(key).first() as { value: string } | null;
  return row ? row.value : null;
}

async function setConfig(DB: D1Database, key: string, value: string) {
  await DB.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?').bind(key, value, value).run();
}

// Discord color mappings
const DISCORD_COLORS: Record<Urgency, number> = {
  urgent: 15158332,    // Red
  average: 15105570,   // Orange
  normal: 3066993,     // Green
  warning: 15105570    // Orange
};

async function sendDiscord(webhookUrl: string, subject: string, body: string, urgency: Urgency, fields?: Record<string, string>): Promise<boolean> {
  try {
    const embedFields = fields ? Object.entries(fields).map(([key, val]) => ({
      name: key, value: val, inline: true
    })) : [];
    
    const payload = {
      embeds: [{
        title: subject,
        description: body,
        color: DISCORD_COLORS[urgency],
        fields: embedFields,
        footer: { text: 'EVM Trading Bot' },
        timestamp: new Date().toISOString()
      }]
    };
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function sendTelegram(botToken: string, chatId: string, subject: string, body: string): Promise<boolean> {
  try {
    const text = `*${subject}*\n\n${body}`;
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function sendEmail(EMAIL: SendEmail, from: string, to: string, subject: string, body: string): Promise<boolean> {
  try {
    await EMAIL.send({
      to,
      from: { email: from },
      subject,
      text: body,
    });
    return true;
  } catch {
    return false;
  }
}

function shouldThrottle(lastSent: string | null, urgency: Urgency): boolean {
  if (!lastSent) return false;
  const last = new Date(lastSent).getTime();
  const now = Date.now();
  if (urgency === 'average' && now - last < 3600000) return true;
  if (urgency === 'normal' && now - last < 86400000) return true;
  return false;
}

export async function sendNotification(
  env: Env,
  urgency: Urgency,
  subject: string,
  body: string,
  fields?: Record<string, string>
): Promise<{ sent: string[]; failed: string[] }> {
  const DB = env['funbo-db'];
  const sent: string[] = [];
  const failed: string[] = [];

  // For warning, cascade to urgent then normal
  const effectiveUrgency = urgency === 'warning' ? 'urgent' : urgency;
  const channelsRaw = await getConfig(DB, `notify_${effectiveUrgency}`);
  if (!channelsRaw) return { sent, failed };

  const lastSentKey = `last_notify_${effectiveUrgency}`;
  const lastSent = await getConfig(DB, lastSentKey);
  if (shouldThrottle(lastSent, effectiveUrgency)) return { sent, failed };

  const channels = channelsRaw.split(',').map(c => c.trim()).filter(Boolean);

for (const channel of channels) {
    switch (channel) {
      case 'discord': {
        const url = await getConfig(DB, 'discord_webhook_url');
        if (url && await sendDiscord(url, subject, body, urgency, fields)) sent.push('discord');
        else failed.push('discord');
        break;
      }
      case 'telegram': {
        const chatId = await getConfig(DB, 'telegram_chat_id');
        const username = await getConfig(DB, 'telegram_username');
        const token = env.TELEGRAM_BOT_TOKEN;
        const target = chatId || (username ? `@${username.replace('@', '')}` : null);
        if (target && token && await sendTelegram(token, target, subject, body)) sent.push('telegram');
        else failed.push('telegram');
        break;
      }
      case 'email': {
        const from = await getConfig(DB, 'notify_email_from');
        const to = await getConfig(DB, 'notify_email_to');
        if (from && to && env.EMAIL && await sendEmail(env.EMAIL, from, to, subject, body)) sent.push('email');
        else failed.push('email');
        break;
      }
    }
  }

  if (sent.length > 0) {
    await setConfig(DB, lastSentKey, new Date().toISOString());
  }

  return { sent, failed };
}
