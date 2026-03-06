/**
 * Converts standard Markdown to Slack's mrkdwn format.
 *
 * Slack mrkdwn differs from Markdown: single * for bold, _ for italic,
 * ~ for strikethrough, <url|text> for links, and no header syntax.
 */
export function markdownToSlackMrkdwn(text: string): string {
  const codeBlocks: string[] = [];
  let result = text.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match);
    return `\0CB${codeBlocks.length - 1}\0`;
  });

  const inlineCode: string[] = [];
  result = result.replace(/`[^`]+`/g, (match) => {
    inlineCode.push(match);
    return `\0IC${inlineCode.length - 1}\0`;
  });

  result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<$2|$1>');

  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>');

  result = result.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');

  result = result.replace(/\*{3}(.+?)\*{3}/g, '_*$1*_');

  result = result.replace(/\*{2}(.+?)\*{2}/g, '*$1*');

  result = result.replace(/~~(.+?)~~/g, '~$1~');

  result = result.replace(/\0CB(\d+)\0/g, (_, i) => codeBlocks[parseInt(i, 10)]);
  result = result.replace(/\0IC(\d+)\0/g, (_, i) => inlineCode[parseInt(i, 10)]);

  return result;
}
