import { describe, expect, mock, test } from 'bun:test';
import { extractImageRefs, isImageFile } from '../media';

describe('isImageFile', () => {
  test('returns true for image mimetypes', () => {
    expect(isImageFile('image/png')).toBe(true);
    expect(isImageFile('image/jpeg')).toBe(true);
    expect(isImageFile('image/gif')).toBe(true);
    expect(isImageFile('image/webp')).toBe(true);
  });

  test('returns false for non-image mimetypes', () => {
    expect(isImageFile('application/pdf')).toBe(false);
    expect(isImageFile('text/plain')).toBe(false);
    expect(isImageFile('video/mp4')).toBe(false);
  });
});

describe('extractImageRefs', () => {
  test('returns empty array when no files', () => {
    expect(extractImageRefs({})).toEqual([]);
    expect(extractImageRefs({ files: [] })).toEqual([]);
  });

  test('extracts only image files', () => {
    const message = {
      files: [
        { mimetype: 'image/png', url_private: 'https://slack.com/img1.png' },
        { mimetype: 'application/pdf', url_private: 'https://slack.com/doc.pdf' },
        { mimetype: 'image/jpeg', url_private: 'https://slack.com/img2.jpg' },
      ],
    };
    const result = extractImageRefs(message);
    expect(result).toEqual([
      { url: 'https://slack.com/img1.png', mimetype: 'image/png' },
      { url: 'https://slack.com/img2.jpg', mimetype: 'image/jpeg' },
    ]);
  });

  test('returns empty when all files are non-image', () => {
    const message = {
      files: [{ mimetype: 'text/plain', url_private: 'https://slack.com/file.txt' }],
    };
    expect(extractImageRefs(message)).toEqual([]);
  });
});

describe('downloadSlackFile', () => {
  test('downloads file with auth header', async () => {
    const fakeBuffer = new ArrayBuffer(4);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => ({
      ok: true,
      arrayBuffer: async () => fakeBuffer,
    })) as unknown as typeof fetch;

    const { downloadSlackFile } = await import('../media');
    const result = await downloadSlackFile('https://slack.com/file.png', 'xoxb-token');
    expect(result).toBeInstanceOf(Buffer);
    expect(globalThis.fetch).toHaveBeenCalledWith('https://slack.com/file.png', {
      headers: { Authorization: 'Bearer xoxb-token' },
    });

    globalThis.fetch = originalFetch;
  });

  test('throws on non-ok response', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => ({
      ok: false,
      status: 404,
    })) as unknown as typeof fetch;

    const { downloadSlackFile } = await import('../media');
    await expect(downloadSlackFile('https://slack.com/missing.png', 'token')).rejects.toThrow(
      'Failed to download file: 404',
    );

    globalThis.fetch = originalFetch;
  });
});
