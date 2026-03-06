import type { Browser, Page } from 'playwright';

const MAX_CONCURRENT_PAGES = 3;
const PAGE_TIMEOUT_MS = 30000;

let browser: Browser | null = null;
const activePages = new Set<Page>();

async function getBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser;

  const { chromium } = await import('playwright');
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  return browser;
}

async function acquirePage(): Promise<Page> {
  if (activePages.size >= MAX_CONCURRENT_PAGES) {
    throw new Error(`Browser pool exhausted (max ${MAX_CONCURRENT_PAGES} concurrent pages)`);
  }

  const b = await getBrowser();
  const page = await b.newPage();
  page.setDefaultTimeout(PAGE_TIMEOUT_MS);
  activePages.add(page);
  return page;
}

async function releasePage(page: Page): Promise<void> {
  activePages.delete(page);
  try {
    await page.close();
  } catch {
    // already closed
  }
}

export class BrowserEngine {
  async screenshot(url: string): Promise<string> {
    const page = await acquirePage();
    try {
      await page.goto(url, { waitUntil: 'networkidle' });
      const buffer = await page.screenshot({ fullPage: false });
      return buffer.toString('base64');
    } finally {
      await releasePage(page);
    }
  }

  async scrape(url: string, selector?: string): Promise<string> {
    const page = await acquirePage();
    try {
      await page.goto(url, { waitUntil: 'networkidle' });
      if (selector) {
        const element = await page.$(selector);
        if (!element) return '';
        return (await element.textContent()) ?? '';
      }
      return await page.content();
    } finally {
      await releasePage(page);
    }
  }

  async fillForm(
    url: string,
    fields: Array<{ selector: string; value: string }>,
    submitSelector?: string,
  ): Promise<{ success: boolean; finalUrl: string }> {
    const page = await acquirePage();
    try {
      await page.goto(url, { waitUntil: 'networkidle' });

      for (const field of fields) {
        await page.fill(field.selector, field.value);
      }

      if (submitSelector) {
        await page.click(submitSelector);
        await page.waitForLoadState('networkidle');
      }

      return { success: true, finalUrl: page.url() };
    } finally {
      await releasePage(page);
    }
  }
}

export async function closeBrowserPool(): Promise<void> {
  for (const page of activePages) {
    try {
      await page.close();
    } catch {
      /* ignore */
    }
  }
  activePages.clear();

  if (browser) {
    await browser.close();
    browser = null;
  }
}
