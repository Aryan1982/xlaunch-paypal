/** First URL or bare domain in free text, plus the text with it removed. */
export const extractUrl = (text: string): { url: string | null; rest: string } => {
  const full = /\bhttps?:\/\/[^\s)>\]"']+/i.exec(text);
  const bare = /\b(?:[a-z0-9-]+\.)+(?:com|io|ai|app|dev|co|net|org|so|sh|xyz|tech|cloud|me|gg|to|fm|ly|us|uk|in)\b(?:\/[^\s)>\]"']*)?/i.exec(text);
  const hit = full ?? bare;
  if (!hit) return { url: null, rest: text.trim() };
  const url = hit[0].replace(/[.,;:!?]+$/, "");
  const rest = text.replace(hit[0], " ").replace(/\s+/g, " ").trim();
  return { url, rest };
};
