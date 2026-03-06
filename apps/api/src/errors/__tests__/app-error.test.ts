import { describe, expect, test } from 'bun:test';
import {
  AppError,
  BudgetExceededError,
  NotFoundError,
  ProviderError,
  ValidationError,
} from '../app-error';

describe('AppError', () => {
  test('sets message, statusCode, and code', () => {
    const err = new AppError('something broke', 500, 'INTERNAL');
    expect(err.message).toBe('something broke');
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe('INTERNAL');
    expect(err.name).toBe('AppError');
  });

  test('is an instance of Error', () => {
    const err = new AppError('test', 400, 'BAD');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
  });

  test('has a stack trace', () => {
    const err = new AppError('trace', 500, 'ERR');
    expect(err.stack).toBeDefined();
    expect(typeof err.stack).toBe('string');
  });
});

describe('NotFoundError', () => {
  test('formats message from resource and id', () => {
    const err = new NotFoundError('Channel', 'abc-123');
    expect(err.message).toBe('Channel not found: abc-123');
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.name).toBe('NotFoundError');
  });

  test('is an instance of AppError', () => {
    const err = new NotFoundError('Skill', 's1');
    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(Error);
  });
});

describe('ValidationError', () => {
  test('sets message with 400 status', () => {
    const err = new ValidationError('Invalid input');
    expect(err.message).toBe('Invalid input');
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.name).toBe('ValidationError');
  });

  test('is an instance of AppError', () => {
    const err = new ValidationError('bad');
    expect(err).toBeInstanceOf(AppError);
  });
});

describe('BudgetExceededError', () => {
  test('formats message and exposes spend/budget', () => {
    const err = new BudgetExceededError('ch-001', 15.5, 10.0);
    expect(err.message).toBe('Budget exceeded for channel ch-001');
    expect(err.statusCode).toBe(429);
    expect(err.code).toBe('BUDGET_EXCEEDED');
    expect(err.name).toBe('BudgetExceededError');
    expect(err.todaySpend).toBe(15.5);
    expect(err.budget).toBe(10.0);
  });

  test('is an instance of AppError', () => {
    const err = new BudgetExceededError('ch-1', 5, 3);
    expect(err).toBeInstanceOf(AppError);
  });
});

describe('ProviderError', () => {
  test('defaults to 502 status', () => {
    const err = new ProviderError('upstream failure');
    expect(err.message).toBe('upstream failure');
    expect(err.statusCode).toBe(502);
    expect(err.code).toBe('PROVIDER_ERROR');
    expect(err.name).toBe('ProviderError');
  });

  test('accepts custom status code', () => {
    const err = new ProviderError('rate limited', 429);
    expect(err.statusCode).toBe(429);
  });

  test('is an instance of AppError', () => {
    const err = new ProviderError('fail');
    expect(err).toBeInstanceOf(AppError);
  });
});
