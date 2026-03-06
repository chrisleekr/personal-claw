import { describe, expect, mock, test } from 'bun:test';

const mockPage = {
  setDefaultTimeout: () => {},
  goto: async () => {},
  screenshot: async () => Buffer.from('fake-screenshot'),
  content: async () => '<html>page content</html>',
  $: async () => ({ textContent: async () => 'selected text' }),
  fill: async () => {},
  click: async () => {},
  waitForLoadState: async () => {},
  url: () => 'https://example.com/done',
  close: async () => {},
};

mock.module('playwright', () => ({
  chromium: {
    launch: async () => ({
      isConnected: () => true,
      newPage: async () => mockPage,
      close: async () => {},
    }),
  },
}));

import { getBrowserTools } from '../tools';

describe('getBrowserTools', () => {
  test('returns browser_screenshot, browser_scrape, browser_fill', () => {
    const tools = getBrowserTools();
    expect(tools.browser_screenshot).toBeDefined();
    expect(tools.browser_scrape).toBeDefined();
    expect(tools.browser_fill).toBeDefined();
  });

  test('browser_screenshot returns base64 image', async () => {
    const tools = getBrowserTools();
    const result = await tools.browser_screenshot.execute(
      { url: 'https://example.com' },
      { toolCallId: 'tc-1', messages: [], abortSignal: new AbortController().signal },
    );
    expect((result as { image: string }).image).toBeDefined();
    expect((result as { mimeType: string }).mimeType).toBe('image/png');
  });

  test('browser_scrape returns page content', async () => {
    const tools = getBrowserTools();
    const result = await tools.browser_scrape.execute(
      { url: 'https://example.com' },
      { toolCallId: 'tc-2', messages: [], abortSignal: new AbortController().signal },
    );
    expect((result as { content: string }).content).toBeDefined();
  });

  test('browser_fill returns success result', async () => {
    const tools = getBrowserTools();
    const result = await tools.browser_fill.execute(
      {
        url: 'https://example.com/form',
        fields: [{ selector: '#name', value: 'Test' }],
        submitSelector: '#submit',
      },
      { toolCallId: 'tc-3', messages: [], abortSignal: new AbortController().signal },
    );
    expect((result as { success: boolean }).success).toBe(true);
    expect((result as { finalUrl: string }).finalUrl).toBeDefined();
  });
});
