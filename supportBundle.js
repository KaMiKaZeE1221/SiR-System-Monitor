'use strict';

const SENSITIVE_KEYS = new Set([
  'authtoken',
  'authorization',
  'credential',
  'credentials',
  'email',
  'host',
  'hostname',
  'ip',
  'ipaddress',
  'lanip',
  'latencyhost',
  'password',
  'secret',
  'sensorcustomnames',
  'token',
  'username',
  'wanip'
]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[n] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function normalizeSensitiveKey(key) {
  return String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function sanitizeSupportText(value, identity = {}) {
  let text = String(value ?? '');
  const replacements = [identity.userName, identity.hostName]
    .map((entry) => String(entry || '').trim())
    .filter((entry) => entry.length >= 2)
    .sort((a, b) => b.length - a.length);

  replacements.forEach((entry) => {
    const escaped = entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(escaped, 'gi'), '[redacted]');
  });

  return text
    .replace(/\b[A-Z]:\\Users\\[^\\\s]+/gi, 'C:\\Users\\[redacted]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[IP redacted]')
    .replace(/\b(?:[A-F0-9]{1,4}:){2,7}[A-F0-9]{1,4}\b/gi, '[IP redacted]')
    .replace(/\b[0-9A-F]{2}(?::[0-9A-F]{2}){5}\b/gi, '[MAC redacted]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email redacted]')
    .replace(/\b(token|password|secret|authorization|credential)(\s*[:=]\s*)[^\s,;]+/gi, '$1$2[redacted]');
}

function sanitizeSupportValue(value, identity = {}, depth = 0) {
  if (depth > 12) return '[maximum depth reached]';
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') return value;
  if (Array.isArray(value)) return value.slice(0, 10000).map((entry) => sanitizeSupportValue(entry, identity, depth + 1));
  if (typeof value === 'object') {
    const safe = {};
    Object.entries(value).forEach(([key, entry]) => {
      if (SENSITIVE_KEYS.has(normalizeSensitiveKey(key))) {
        safe[key] = '[redacted]';
      } else {
        safe[key] = sanitizeSupportValue(entry, identity, depth + 1);
      }
    });
    return safe;
  }

  const text = String(value);
  if ((text.startsWith('{') || text.startsWith('[')) && text.length <= 2 * 1024 * 1024) {
    try {
      return sanitizeSupportValue(JSON.parse(text), identity, depth + 1);
    } catch (error) {}
  }
  return sanitizeSupportText(text.slice(0, 2 * 1024 * 1024), identity);
}

function toDosDateTime(dateValue) {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue || Date.now());
  const year = Math.max(1980, date.getFullYear());
  return {
    time: ((date.getHours() & 0x1F) << 11) | ((date.getMinutes() & 0x3F) << 5) | ((Math.floor(date.getSeconds() / 2)) & 0x1F),
    date: (((year - 1980) & 0x7F) << 9) | (((date.getMonth() + 1) & 0x0F) << 5) | (date.getDate() & 0x1F)
  };
}

function createSupportZip(files, dateValue = new Date()) {
  const entries = Object.entries(files || {}).map(([rawName, rawContent]) => {
    const name = String(rawName || '').replace(/\\/g, '/').replace(/^\/+|\.\.(?:\/|$)/g, '') || 'support.txt';
    const nameBuffer = Buffer.from(name, 'utf8');
    const content = Buffer.isBuffer(rawContent) ? rawContent : Buffer.from(String(rawContent ?? ''), 'utf8');
    return { nameBuffer, content, crc: crc32(content), offset: 0 };
  });
  if (!entries.length) throw new Error('The support bundle has no files.');

  const stamp = toDosDateTime(dateValue);
  const localParts = [];
  let localOffset = 0;
  entries.forEach((entry) => {
    entry.offset = localOffset;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034B50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(stamp.time, 10);
    header.writeUInt16LE(stamp.date, 12);
    header.writeUInt32LE(entry.crc, 14);
    header.writeUInt32LE(entry.content.length, 18);
    header.writeUInt32LE(entry.content.length, 22);
    header.writeUInt16LE(entry.nameBuffer.length, 26);
    header.writeUInt16LE(0, 28);
    localParts.push(header, entry.nameBuffer, entry.content);
    localOffset += header.length + entry.nameBuffer.length + entry.content.length;
  });

  const centralParts = [];
  let centralSize = 0;
  entries.forEach((entry) => {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014B50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(stamp.time, 12);
    header.writeUInt16LE(stamp.date, 14);
    header.writeUInt32LE(entry.crc, 16);
    header.writeUInt32LE(entry.content.length, 20);
    header.writeUInt32LE(entry.content.length, 24);
    header.writeUInt16LE(entry.nameBuffer.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(0, 38);
    header.writeUInt32LE(entry.offset, 42);
    centralParts.push(header, entry.nameBuffer);
    centralSize += header.length + entry.nameBuffer.length;
  });

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054B50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

module.exports = {
  createSupportZip,
  sanitizeSupportText,
  sanitizeSupportValue
};
