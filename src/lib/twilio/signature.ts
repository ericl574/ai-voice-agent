import { createHmac, timingSafeEqual } from 'crypto';

// Twilio webhook signature validation (X-Twilio-Signature), implemented per Twilio's spec so we
// don't need the full twilio SDK: signature = Base64(HMAC-SHA1(url + concat(sorted param name +
// value), authToken)). https://www.twilio.com/docs/usage/security#validating-requests

export function computeTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
): string {
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((k) => k + params[k])
      .join('');
  return createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64');
}

/**
 * Validates a Twilio webhook request signature against one or more candidate URLs (the publicly
 * configured webhook URL may differ from the proxied req.url behind Vercel — accept either).
 */
export function isValidTwilioSignature(
  authToken: string,
  signature: string | null,
  candidateUrls: string[],
  params: Record<string, string>,
): boolean {
  if (!signature) return false;
  const sigBuf = Buffer.from(signature);
  for (const url of candidateUrls) {
    const expected = Buffer.from(computeTwilioSignature(authToken, url, params));
    if (expected.length === sigBuf.length && timingSafeEqual(expected, sigBuf)) {
      return true;
    }
  }
  return false;
}
