import { describe, expect, test } from 'bun:test';
import { markdownToSlackMrkdwn } from '../mrkdwn';

describe('markdownToSlackMrkdwn', () => {
  test('converts bold **text** to *text*', () => {
    expect(markdownToSlackMrkdwn('This is **bold** text')).toBe('This is *bold* text');
  });

  test('converts multiple bold segments', () => {
    expect(markdownToSlackMrkdwn('**one** and **two**')).toBe('*one* and *two*');
  });

  test('converts bold+italic ***text*** to _*text*_', () => {
    expect(markdownToSlackMrkdwn('This is ***bold italic*** text')).toBe(
      'This is _*bold italic*_ text',
    );
  });

  test('converts strikethrough ~~text~~ to ~text~', () => {
    expect(markdownToSlackMrkdwn('This is ~~deleted~~ text')).toBe('This is ~deleted~ text');
  });

  test('converts links [text](url) to <url|text>', () => {
    expect(markdownToSlackMrkdwn('Visit [Google](https://google.com) now')).toBe(
      'Visit <https://google.com|Google> now',
    );
  });

  test('converts images ![alt](url) to <url|alt>', () => {
    expect(markdownToSlackMrkdwn('![logo](https://example.com/img.png)')).toBe(
      '<https://example.com/img.png|logo>',
    );
  });

  test('converts headers to bold', () => {
    expect(markdownToSlackMrkdwn('## Section Title')).toBe('*Section Title*');
    expect(markdownToSlackMrkdwn('### Subsection')).toBe('*Subsection*');
    expect(markdownToSlackMrkdwn('# Top Level')).toBe('*Top Level*');
  });

  test('preserves inline code', () => {
    expect(markdownToSlackMrkdwn('Use `**not bold**` here')).toBe('Use `**not bold**` here');
  });

  test('preserves code blocks', () => {
    const input = '```\n**not bold**\n[not a link](url)\n```';
    expect(markdownToSlackMrkdwn(input)).toBe(input);
  });

  test('preserves code blocks with language tag', () => {
    const input = '```typescript\nconst x = 1;\n```';
    expect(markdownToSlackMrkdwn(input)).toBe(input);
  });

  test('handles mixed content with code blocks', () => {
    const input = '**bold** then ```\n**code**\n``` then **more bold**';
    expect(markdownToSlackMrkdwn(input)).toBe('*bold* then ```\n**code**\n``` then *more bold*');
  });

  test('converts blockquotes (unchanged)', () => {
    expect(markdownToSlackMrkdwn('> quoted text')).toBe('> quoted text');
  });

  test('converts bullet lists (unchanged)', () => {
    const input = '- item one\n- item two';
    expect(markdownToSlackMrkdwn(input)).toBe(input);
  });

  test('handles multiline realistic AI response', () => {
    const input = [
      "It seems like your message might be incomplete. Could you clarify what you're asking about? For example:",
      '',
      '- **"What\'s happening now?"** — Are you asking about the current status?',
      '- **"What time is it now?"** — Are you asking about the current time?',
      '- **Something else?** — Did you mean to ask a specific question?',
    ].join('\n');

    const expected = [
      "It seems like your message might be incomplete. Could you clarify what you're asking about? For example:",
      '',
      '- *"What\'s happening now?"* — Are you asking about the current status?',
      '- *"What time is it now?"* — Are you asking about the current time?',
      '- *Something else?* — Did you mean to ask a specific question?',
    ].join('\n');

    expect(markdownToSlackMrkdwn(input)).toBe(expected);
  });

  test('returns plain text unchanged', () => {
    const input = 'Just a plain message with no formatting.';
    expect(markdownToSlackMrkdwn(input)).toBe(input);
  });
});
