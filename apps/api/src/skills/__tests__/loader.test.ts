import { beforeEach, describe, expect, mock, test } from 'bun:test';

let mockSelectRows: Array<{ id: string; content: string }> = [];

function chainable(getRows: () => unknown[]): unknown {
  const methods: Record<string, unknown> = {};
  for (const name of ['from', 'where', 'orderBy', 'limit', 'groupBy']) {
    methods[name] = () => chainable(getRows);
  }
  return Object.assign([...getRows()], methods);
}

mock.module('../../db', () => ({
  getDb: () => ({
    select: () => chainable(() => mockSelectRows),
  }),
}));

import { SkillsLoader } from '../loader';

describe('SkillsLoader', () => {
  const CHANNEL_ID = 'ch-loader-test';

  beforeEach(() => {
    mockSelectRows = [];
  });

  test('loadForChannel returns skills from DB', async () => {
    mockSelectRows = [
      { id: 'sk-1', content: 'Deploy to AWS using CLI.' },
      { id: 'sk-2', content: 'Generate reports from data.' },
    ];
    const loader = new SkillsLoader();
    const skills = await loader.loadForChannel(CHANNEL_ID);
    expect(skills).toHaveLength(2);
    expect(skills[0].id).toBe('sk-1');
    expect(skills[1].content).toContain('reports');
  });

  test('loadForChannel filters empty content', async () => {
    mockSelectRows = [
      { id: 'sk-1', content: 'Has content' },
      { id: 'sk-2', content: '' },
    ];
    const loader = new SkillsLoader();
    const skills = await loader.loadForChannel(`${CHANNEL_ID}-filter`);
    expect(skills).toHaveLength(1);
    expect(skills[0].id).toBe('sk-1');
  });

  test('loadForChannel caches results per channel', async () => {
    mockSelectRows = [{ id: 'sk-1', content: 'Cached skill' }];
    const loader = new SkillsLoader();
    const channelId = `${CHANNEL_ID}-cache-${Date.now()}`;
    const first = await loader.loadForChannel(channelId);
    mockSelectRows = []; // DB would return nothing if called again
    const second = await loader.loadForChannel(channelId);
    expect(first).toEqual(second);
  });

  test('invalidateChannel clears cache for specific channel', async () => {
    mockSelectRows = [{ id: 'sk-1', content: 'Before invalidation' }];
    const loader = new SkillsLoader();
    const channelId = `${CHANNEL_ID}-inv-${Date.now()}`;
    await loader.loadForChannel(channelId);
    loader.invalidateChannel(channelId);
    mockSelectRows = [{ id: 'sk-2', content: 'After invalidation' }];
    const skills = await loader.loadForChannel(channelId);
    expect(skills[0].id).toBe('sk-2');
  });

  test('invalidateAll clears entire cache', async () => {
    const loader = new SkillsLoader();
    mockSelectRows = [{ id: 'sk-1', content: 'Channel A' }];
    await loader.loadForChannel('ch-a');
    mockSelectRows = [{ id: 'sk-2', content: 'Channel B' }];
    await loader.loadForChannel('ch-b');
    loader.invalidateAll();
    mockSelectRows = [];
    const result = await loader.loadForChannel('ch-a');
    expect(result).toEqual([]);
  });
});
