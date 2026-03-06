import { describe, expect, test } from 'bun:test';
import { ApprovalDismissedError } from '../approvals';

describe('ApprovalDismissedError', () => {
  test('creates error with correct name and message', () => {
    const err = new ApprovalDismissedError();
    expect(err.name).toBe('ApprovalDismissedError');
    expect(err.message).toBe('Approval dismissed by new message');
    expect(err).toBeInstanceOf(Error);
  });
});
