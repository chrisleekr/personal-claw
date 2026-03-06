import { describe, expect, test } from 'bun:test';
import type { PiiPattern } from '../pii-masker';
import { addPiiPattern, maskPII, maskPiiInObject } from '../pii-masker';

describe('maskPII', () => {
  describe('email', () => {
    test('masks middle of local part, preserves domain', () => {
      expect(maskPII('john.doe@example.com')).toBe('j******e@example.com');
    });

    test('preserves length', () => {
      const input = 'contact me at alice.b@corp.io please';
      expect(maskPII(input).length).toBe(input.length);
    });

    test('masks short local part (2 chars)', () => {
      expect(maskPII('ab@x.co')).toBe('**@x.co');
    });

    test('masks single char local part', () => {
      expect(maskPII('a@x.co')).toBe('*@x.co');
    });

    test('handles multiple emails in one string', () => {
      const input = 'from john@a.com to jane@b.com';
      const result = maskPII(input);
      expect(result).not.toContain('john');
      expect(result).not.toContain('jane');
      expect(result.length).toBe(input.length);
    });
  });

  describe('phone', () => {
    test('masks middle digits with dashes', () => {
      expect(maskPII('555-123-4567')).toBe('555-***-4567');
    });

    test('masks middle digits with spaces', () => {
      expect(maskPII('555 123 4567')).toBe('555 *** 4567');
    });

    test('masks middle digits without separators', () => {
      expect(maskPII('5551234567')).toBe('555***4567');
    });

    test('handles country code prefix', () => {
      const input = '+1-555-123-4567';
      const result = maskPII(input);
      expect(result.length).toBe(input.length);
      expect(result).toContain('4567');
    });

    test('preserves length', () => {
      const input = 'call 555-123-4567 now';
      expect(maskPII(input).length).toBe(input.length);
    });
  });

  describe('credit card', () => {
    test('masks middle of 16-digit card (no separators)', () => {
      expect(maskPII('4111111111111111')).toBe('4111********1111');
    });

    test('masks middle of card with dashes', () => {
      expect(maskPII('4111-1111-1111-1111')).toBe('4111-****-****-1111');
    });

    test('masks middle of card with spaces', () => {
      expect(maskPII('4111 1111 1111 1111')).toBe('4111 **** **** 1111');
    });

    test('preserves length', () => {
      const input = 'card: 4111-1111-1111-1111 end';
      expect(maskPII(input).length).toBe(input.length);
    });
  });

  describe('IP addresses pass through unmasked', () => {
    test('IPv4 addresses are not masked', () => {
      expect(maskPII('192.168.1.100')).toBe('192.168.1.100');
    });

    test('IP in log context is preserved', () => {
      const input = 'request from 10.0.0.1 at path /api/test';
      expect(maskPII(input)).toBe(input);
    });
  });

  describe('mixed PII types', () => {
    test('masks email and phone in same string', () => {
      const input = 'user john@test.com phone 555-123-4567';
      const result = maskPII(input);
      expect(result).not.toContain('john');
      expect(result).toContain('4567');
      expect(result).toContain('555');
      expect(result.length).toBe(input.length);
    });

    test('no PII returns input unchanged', () => {
      const input = 'just a normal log message with no sensitive data';
      expect(maskPII(input)).toBe(input);
    });
  });
});

describe('maskPiiInObject', () => {
  test('masks strings in flat object', () => {
    const input = { email: 'alice@test.com', name: 'Alice' };
    const result = maskPiiInObject(input);
    expect(result.email).toBe('a***e@test.com');
    expect(result.name).toBe('Alice');
  });

  test('masks strings in nested objects', () => {
    const input = {
      user: {
        contact: { email: 'bob@example.com', phone: '555-111-2222' },
      },
    };
    const result = maskPiiInObject(input);
    expect(result.user.contact.email).toBe('b*b@example.com');
    expect(result.user.contact.phone).toBe('555-***-2222');
  });

  test('masks strings in arrays', () => {
    const input = { emails: ['a@b.co', 'cd@e.co'] };
    const result = maskPiiInObject(input);
    expect(result.emails[0]).toBe('*@b.co');
    expect(result.emails[1]).toBe('**@e.co');
  });

  test('preserves non-string values', () => {
    const input = { count: 42, active: true, data: null };
    const result = maskPiiInObject(input);
    expect(result).toEqual(input);
  });

  test('handles bare string input', () => {
    expect(maskPiiInObject('john@test.com')).toBe('j**n@test.com');
  });
});

describe('addPiiPattern', () => {
  test('custom pattern is applied by maskPII', () => {
    const ssnPattern: PiiPattern = {
      name: 'ssn',
      regex: /\b\d{3}-\d{2}-\d{4}\b/g,
      mask: (match: string) => {
        return `***-**-${match.slice(-4)}`;
      },
    };
    addPiiPattern(ssnPattern);

    expect(maskPII('SSN: 123-45-6789')).toBe('SSN: ***-**-6789');
  });
});
