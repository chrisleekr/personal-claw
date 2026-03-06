import { describe, expect, test } from 'bun:test';
import { errorDetails } from '../error-fmt';

describe('errorDetails', () => {
  test('extracts message and stack from standard Error', () => {
    const err = new Error('something broke');
    const details = errorDetails(err);
    expect(details.error).toBe('something broke');
    expect(details.stack).toBeDefined();
    expect(typeof details.stack).toBe('string');
  });

  test('omits errorName when error.name is generic "Error"', () => {
    const err = new Error('generic');
    const details = errorDetails(err);
    expect(details.errorName).toBeUndefined();
  });

  test('includes errorName for typed errors', () => {
    const err = new TypeError('bad type');
    const details = errorDetails(err);
    expect(details.errorName).toBe('TypeError');
  });

  test('extracts statusCode when present', () => {
    const err = Object.assign(new Error('not found'), { statusCode: 404 });
    const details = errorDetails(err);
    expect(details.statusCode).toBe(404);
  });

  test('extracts url when present', () => {
    const err = Object.assign(new Error('api fail'), { url: 'https://api.example.com/v1' });
    const details = errorDetails(err);
    expect(details.url).toBe('https://api.example.com/v1');
  });

  test('extracts isRetryable when present', () => {
    const err = Object.assign(new Error('timeout'), { isRetryable: true });
    const details = errorDetails(err);
    expect(details.isRetryable).toBe(true);
  });

  test('truncates long responseBody', () => {
    const longBody = 'x'.repeat(3000);
    const err = Object.assign(new Error('api error'), { responseBody: longBody });
    const details = errorDetails(err);
    expect(typeof details.responseBody).toBe('string');
    expect((details.responseBody as string).length).toBeLessThan(longBody.length);
    expect(details.responseBody as string).toContain('[truncated]');
  });

  test('preserves short responseBody', () => {
    const err = Object.assign(new Error('api error'), { responseBody: '{"error":"bad"}' });
    const details = errorDetails(err);
    expect(details.responseBody).toBe('{"error":"bad"}');
  });

  test('extracts cause from nested Error', () => {
    const cause = new Error('root cause');
    const err = new Error('wrapper', { cause });
    const details = errorDetails(err);
    expect(details.cause).toBe('root cause');
    expect(details.causeStack).toBeDefined();
  });

  test('extracts non-Error cause as string', () => {
    const err = new Error('wrapper', { cause: 'string cause' });
    const details = errorDetails(err);
    expect(details.cause).toBe('string cause');
    expect(details.causeStack).toBeUndefined();
  });

  test('handles non-Error input (string)', () => {
    const details = errorDetails('plain string error');
    expect(details).toEqual({ error: 'plain string error' });
  });

  test('handles non-Error input (number)', () => {
    const details = errorDetails(42);
    expect(details).toEqual({ error: '42' });
  });

  test('handles null input', () => {
    const details = errorDetails(null);
    expect(details).toEqual({ error: 'null' });
  });

  test('handles undefined input', () => {
    const details = errorDetails(undefined);
    expect(details).toEqual({ error: 'undefined' });
  });
});
