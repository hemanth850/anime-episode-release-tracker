const crypto = require('crypto');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, encoded) {
  const parts = String(encoded || '').split(':');
  if (parts.length !== 2) return false;

  const [salt, hash] = parts;
  const incomingHash = crypto.scryptSync(password, salt, 64).toString('hex');
  const original = Buffer.from(hash, 'hex');
  const incoming = Buffer.from(incomingHash, 'hex');

  if (original.length !== incoming.length) return false;
  return crypto.timingSafeEqual(original, incoming);
}

function createSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSessionToken,
};
