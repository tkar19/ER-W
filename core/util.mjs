import { sha256HexString } from './hash.mjs';

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

export function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value) {
  const input = typeof value === 'string' ? value : canonicalStringify(value);
  return sha256HexString(input);
}

export function deepClone(value) {
  return structuredClone(value);
}

export function safeId(prefix = 'id') {
  const bytes=new Uint8Array(8);
  if(!globalThis.crypto?.getRandomValues) throw new Error('Secure random source is unavailable.');
  globalThis.crypto.getRandomValues(bytes);
  return `${prefix}_${Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('')}`;
}

export function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

export function nowIso() {
  return new Date().toISOString();
}

export function slugify(input) {
  return String(input || '')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 48) || 'campaign';
}

export function parseDurationMinutes(text, timeUnits = null) {
  const minutesPerHour=Number(timeUnits?.minutes_per_hour ?? 60);
  const hoursPerDay=Number(timeUnits?.hours_per_day ?? 24);
  if(!Number.isInteger(minutesPerHour)||minutesPerHour<=0||!Number.isInteger(hoursPerDay)||hoursPerDay<=0) throw new Error('Duration parser received invalid world calendar units.');
  const minutesPerDay=minutesPerHour*hoursPerDay;
  let s = String(text || '').toLowerCase();
  const words = {
    zero:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10,
    eleven:11, twelve:12, thirteen:13, fourteen:14, fifteen:15, sixteen:16, seventeen:17,
    eighteen:18, nineteen:19, twenty:20, thirty:30, forty:40, fifty:50, sixty:60
  };
  s = s.replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty)\b/g, w => String(words[w]));
  s = s.replace(/\bhalf\s+(?:an?\s+)?hour\b/g, '0.5 hour').replace(/\b(?:an?|one)\s+hour\b/g, '1 hour');
  const number = '(\\d+(?:\\.\\d+)?)';
  const day = s.match(new RegExp(`${number}\\s*(?:days?|d)\\b`));
  const hour = s.match(new RegExp(`${number}\\s*(?:hours?|hrs?|h)\\b`));
  const min = s.match(new RegExp(`${number}\\s*(?:minutes?|mins?|m)\\b`));
  let total = 0;
  if (day) total += Number(day[1]) * minutesPerDay;
  if (hour) total += Number(hour[1]) * minutesPerHour;
  if (min) total += Number(min[1]);
  return total > 0 ? Math.round(total) : null;
}
