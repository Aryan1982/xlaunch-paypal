/** Mirrors server/src/lib/url.ts so the landing page can validate instantly. */
export const hasUrl = (text: string): boolean =>
  /\bhttps?:\/\/[^\s)>\]"']+/i.test(text) ||
  /\b(?:[a-z0-9-]+\.)+(?:com|io|ai|app|dev|co|net|org|so|sh|xyz|tech|cloud|me|gg|to|fm|ly|us|uk|in)\b/i.test(text);
