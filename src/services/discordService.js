async function sendDiscordReminder(webhookUrl, content) {
  if (!webhookUrl) return;

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Discord webhook failed (${response.status}): ${body}`);
  }
}

module.exports = {
  sendDiscordReminder,
};
