import { AsyncLocalStorage } from 'node:async_hooks';
import { configure, getConsoleSink, getLogger, jsonLinesFormatter } from '@logtape/logtape';
import { config } from './config';

const isDev = config.NODE_ENV !== 'production';

export async function initLogger(): Promise<void> {
  await configure({
    sinks: {
      console: getConsoleSink({
        formatter: jsonLinesFormatter,
      }),
    },
    loggers: [
      {
        category: ['personalclaw'],
        lowestLevel: isDev ? 'debug' : 'info',
        sinks: ['console'],
      },
      {
        category: ['hono'],
        lowestLevel: isDev ? 'debug' : 'info',
        sinks: ['console'],
      },
      {
        category: ['logtape', 'meta'],
        lowestLevel: 'warning',
        sinks: ['console'],
      },
    ],
    contextLocalStorage: new AsyncLocalStorage(),
  });
}

export { getLogger };
