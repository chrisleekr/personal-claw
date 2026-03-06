const threadLocks = new Map<string, Promise<void>>();

export async function withThreadLock<T>(threadId: string, fn: () => Promise<T>): Promise<T> {
  const previous = threadLocks.get(threadId) ?? Promise.resolve();

  let resolve!: () => void;
  const current = new Promise<void>((r) => {
    resolve = r;
  });
  threadLocks.set(threadId, current);

  try {
    await previous;
    return await fn();
  } finally {
    resolve();
    if (threadLocks.get(threadId) === current) {
      threadLocks.delete(threadId);
    }
  }
}
