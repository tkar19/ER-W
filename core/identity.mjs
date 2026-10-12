// Campaign identifiers are filesystem keys, API object identifiers, and save identities.
// They are generated internally and therefore intentionally use a narrow ASCII grammar.
const CAMPAIGN_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,94}[a-z0-9])?$/;

export function validateCampaignId(value) {
  if (typeof value !== 'string') throw new Error('Campaign ID must be a string.');
  if (value.length < 1 || value.length > 96) throw new Error('Campaign ID length is invalid.');
  if (!CAMPAIGN_ID_RE.test(value)) throw new Error('Campaign ID contains forbidden characters.');
  return value;
}

export function isValidCampaignId(value) {
  try { validateCampaignId(value); return true; } catch { return false; }
}
