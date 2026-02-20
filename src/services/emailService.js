const nodemailer = require('nodemailer');
const config = require('../config');

function createTransporter() {
  if (!config.smtp.host || !config.smtp.user || !config.smtp.pass) {
    return null;
  }

  return nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: {
      user: config.smtp.user,
      pass: config.smtp.pass,
    },
  });
}

const transporter = createTransporter();

async function sendEmailReminder(to, subject, text) {
  if (!to) return;

  if (!transporter) {
    console.log(`[email:dry-run] to=${to} subject=${subject} message=${text}`);
    return;
  }

  await transporter.sendMail({
    from: config.smtp.from,
    to,
    subject,
    text,
  });
}

module.exports = {
  sendEmailReminder,
};
