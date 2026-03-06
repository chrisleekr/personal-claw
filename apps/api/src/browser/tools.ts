import { tool } from 'ai';
import { z } from 'zod';
import { BrowserEngine } from './engine';

const browserEngine = new BrowserEngine();

export function getBrowserTools() {
  return {
    browser_screenshot: tool({
      description: 'Capture a screenshot of a web page. Returns a base64-encoded PNG image.',
      inputSchema: z.object({
        url: z.string().url().describe('The URL to screenshot'),
      }),
      execute: async ({ url }) => {
        const base64 = await browserEngine.screenshot(url);
        return { image: base64, mimeType: 'image/png' };
      },
    }),
    browser_scrape: tool({
      description: 'Extract text content from a web page, optionally filtered by CSS selector.',
      inputSchema: z.object({
        url: z.string().url().describe('The URL to scrape'),
        selector: z.string().optional().describe('CSS selector to extract specific content'),
      }),
      execute: async ({ url, selector }) => {
        const content = await browserEngine.scrape(url, selector);
        const truncated =
          content.length > 10000 ? `${content.slice(0, 10000)}\n[truncated]` : content;
        return { content: truncated };
      },
    }),
    browser_fill: tool({
      description: 'Fill out a web form and optionally submit it.',
      inputSchema: z.object({
        url: z.string().url().describe('The URL of the form'),
        fields: z.array(
          z.object({
            selector: z.string().describe('CSS selector for the input field'),
            value: z.string().describe('Value to fill in'),
          }),
        ),
        submitSelector: z.string().optional().describe('CSS selector for the submit button'),
      }),
      execute: async ({ url, fields, submitSelector }) => {
        return browserEngine.fillForm(url, fields, submitSelector);
      },
    }),
  };
}
