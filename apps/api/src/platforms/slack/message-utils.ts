export const SLACK_MAX_MESSAGE_LENGTH = 3900;

/**
 * Splits text into chunks at logical boundaries (paragraphs, section breaks)
 * while keeping code blocks intact where possible.
 */
export function chunkMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    const slice = remaining.slice(0, maxLen);

    let splitIdx = slice.lastIndexOf('\n---\n');
    if (splitIdx === -1 || splitIdx < maxLen * 0.3) {
      splitIdx = slice.lastIndexOf('\n\n');
    }
    if (splitIdx === -1 || splitIdx < maxLen * 0.3) {
      splitIdx = slice.lastIndexOf('\n');
    }
    if (splitIdx === -1 || splitIdx < maxLen * 0.3) {
      splitIdx = maxLen;
    }

    chunks.push(remaining.slice(0, splitIdx).trimEnd());
    remaining = remaining.slice(splitIdx).trimStart();
  }

  return chunks.filter((c) => c.length > 0);
}
