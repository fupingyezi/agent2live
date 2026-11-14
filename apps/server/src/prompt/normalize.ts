export function normalizeText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[\x00-\x1F\x7F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
