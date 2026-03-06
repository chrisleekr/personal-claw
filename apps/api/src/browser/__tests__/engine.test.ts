import { describe, expect, mock, test } from 'bun:test';

const mockPage = {
  setDefaultTimeout: () => {},
  goto: async () => {},
  screenshot: async () => Buffer.from('screenshot-data'),
  content: async () => '<html><body>Full page</body></html>',
  $: async (selector: string) =>
    selector === '.missing' ? null : { textContent: async () => 'Selected content' },
  fill: async () => {},
  click: async () => {},
  waitForLoadState: async () => {},
  url: () => 'https://example.com/submitted',
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

import { BrowserEngine, closeBrowserPool } from '../engine';

describe('BrowserEngine', () => {
  test('screenshot returns base64 string', async () => {
    const engine = new BrowserEngine();
    const result = await engine.screenshot('https://example.com');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  test('scrape returns full page content without selector', async () => {
    const engine = new BrowserEngine();
    const result = await engine.scrape('https://example.com');
    expect(result).toContain('Full page');
  });

  test('scrape returns selected content with selector', async () => {
    const engine = new BrowserEngine();
    const result = await engine.scrape('https://example.com', '.content');
    expect(result).toBe('Selected content');
  });

  test('scrape returns empty string for missing selector', async () => {
    const engine = new BrowserEngine();
    const result = await engine.scrape('https://example.com', '.missing');
    expect(result).toBe('');
  });

  test('fillForm fills fields and returns success', async () => {
    const engine = new BrowserEngine();
    const result = await engine.fillForm(
      'https://example.com/form',
      [{ selector: '#name', value: 'Test User' }],
      '#submit',
    );
    expect(result.success).toBe(true);
    expect(result.finalUrl).toBe('https://example.com/submitted');
  });

  test('fillForm works without submit selector', async () => {
    const engine = new BrowserEngine();
    const result = await engine.fillForm('https://example.com/form', [
      { selector: '#email', value: 'test@example.com' },
    ]);
    expect(result.success).toBe(true);
  });
});

describe('closeBrowserPool', () => {
  test('does not throw', async () => {
    await expect(closeBrowserPool()).resolves.toBeUndefined();
  });
});
