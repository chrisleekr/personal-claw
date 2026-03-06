import type { ImageAttachment } from '@personalclaw/shared';

export async function downloadSlackFile(fileUrl: string, token: string): Promise<Buffer> {
  const response = await fetch(fileUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export function isImageFile(mimetype: string): boolean {
  return mimetype.startsWith('image/');
}

interface SlackFileAttachment {
  mimetype: string;
  url_private: string;
}

interface MessageWithFiles {
  files?: SlackFileAttachment[];
}

export function extractImageRefs(
  message: MessageWithFiles,
): Array<{ url: string; mimetype: string }> {
  const files = message.files;
  if (!files || files.length === 0) return [];
  return files
    .filter((f) => isImageFile(f.mimetype))
    .map((f) => ({ url: f.url_private, mimetype: f.mimetype }));
}

export async function downloadImages(
  refs: Array<{ url: string; mimetype: string }>,
  token: string,
): Promise<ImageAttachment[]> {
  const results = await Promise.all(
    refs.map(async (ref) => {
      const data = await downloadSlackFile(ref.url, token);
      return { data, mimetype: ref.mimetype };
    }),
  );
  return results;
}
