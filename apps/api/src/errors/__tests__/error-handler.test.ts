import { describe, expect, mock, test } from 'bun:test';
import { ZodError, type ZodIssue } from 'zod';
import { AppError } from '../app-error';

mock.module('../../utils/error-fmt', () => ({
  errorDetails: (err: unknown) => ({ message: String(err) }),
}));

import { errorHandler } from '../error-handler';

function createMockContext(): {
  json: ReturnType<typeof mock>;
  req: { path: string; method: string };
} {
  return {
    json: mock((body: unknown, status: number) => ({ body, status })),
    req: { path: '/test', method: 'POST' },
  };
}

describe('errorHandler', () => {
  test('returns 400 with VALIDATION_ERROR for ZodError', () => {
    const issues: ZodIssue[] = [
      {
        code: 'invalid_type',
        expected: 'string',
        received: 'number',
        path: ['name'],
        message: 'Expected string',
      },
    ];
    const zodErr = new ZodError(issues);
    const ctx = createMockContext();

    errorHandler(zodErr, ctx as never);

    expect(ctx.json).toHaveBeenCalledTimes(1);
    const [body, status] = ctx.json.mock.calls[0] as [Record<string, unknown>, number];
    expect(status).toBe(400);
    expect(body.error).toBe('VALIDATION_ERROR');
    expect(body.message).toBe('Request validation failed');
    expect(body.details).toEqual([{ path: 'name', message: 'Expected string' }]);
  });

  test('returns correct status and code for AppError', () => {
    const appErr = new AppError('Not found', 404, 'NOT_FOUND');
    const ctx = createMockContext();

    errorHandler(appErr, ctx as never);

    expect(ctx.json).toHaveBeenCalledTimes(1);
    const [body, status] = ctx.json.mock.calls[0] as [Record<string, unknown>, number];
    expect(status).toBe(404);
    expect(body.error).toBe('NOT_FOUND');
    expect(body.message).toBe('Not found');
  });

  test('handles AppError with 429 status', () => {
    const appErr = new AppError('Rate limited', 429, 'BUDGET_EXCEEDED');
    const ctx = createMockContext();

    errorHandler(appErr, ctx as never);

    const [body, status] = ctx.json.mock.calls[0] as [Record<string, unknown>, number];
    expect(status).toBe(429);
    expect(body.error).toBe('BUDGET_EXCEEDED');
  });

  test('returns 500 with INTERNAL for generic Error', () => {
    const genericErr = new Error('something unexpected');
    const ctx = createMockContext();

    errorHandler(genericErr, ctx as never);

    expect(ctx.json).toHaveBeenCalledTimes(1);
    const [body, status] = ctx.json.mock.calls[0] as [Record<string, unknown>, number];
    expect(status).toBe(500);
    expect(body.error).toBe('INTERNAL');
    expect(body.message).toBe('Internal server error');
  });

  test('ZodError with multiple issues maps all paths', () => {
    const issues: ZodIssue[] = [
      {
        code: 'invalid_type',
        expected: 'string',
        received: 'undefined',
        path: ['email'],
        message: 'Required',
      },
      {
        code: 'too_small',
        minimum: 1,
        inclusive: true,
        type: 'string',
        path: ['name'],
        message: 'Too short',
      },
    ];
    const zodErr = new ZodError(issues);
    const ctx = createMockContext();

    errorHandler(zodErr, ctx as never);

    const [body] = ctx.json.mock.calls[0] as [
      { details: Array<{ path: string; message: string }> },
    ];
    expect(body.details).toHaveLength(2);
    expect(body.details[0].path).toBe('email');
    expect(body.details[1].path).toBe('name');
  });

  test('ZodError with nested path joins with dots', () => {
    const issues: ZodIssue[] = [
      {
        code: 'invalid_type',
        expected: 'string',
        received: 'number',
        path: ['config', 'maxTokens'],
        message: 'Expected string',
      },
    ];
    const zodErr = new ZodError(issues);
    const ctx = createMockContext();

    errorHandler(zodErr, ctx as never);

    const [body] = ctx.json.mock.calls[0] as [{ details: Array<{ path: string }> }];
    expect(body.details[0].path).toBe('config.maxTokens');
  });

  test('AppError takes priority over generic Error handler', () => {
    const err = new AppError('Custom error', 422, 'UNPROCESSABLE');
    const ctx = createMockContext();

    errorHandler(err, ctx as never);

    const [body, status] = ctx.json.mock.calls[0] as [Record<string, unknown>, number];
    expect(status).toBe(422);
    expect(body.error).toBe('UNPROCESSABLE');
    expect(body.message).toBe('Custom error');
  });
});
