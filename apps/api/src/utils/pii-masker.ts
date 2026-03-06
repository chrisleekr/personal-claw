export interface PiiPattern {
  readonly name: string;
  readonly regex: RegExp;
  readonly mask: (match: string) => string;
}

function maskEmailMatch(match: string): string {
  const atIndex = match.indexOf('@');
  if (atIndex < 0) return match;

  const local = match.slice(0, atIndex);
  const domain = match.slice(atIndex);

  if (local.length <= 2) return '*'.repeat(local.length) + domain;

  return local[0] + '*'.repeat(local.length - 2) + local[local.length - 1] + domain;
}

function maskPhoneMatch(match: string): string {
  const digits = match.replace(/\D/g, '');
  if (digits.length < 7) return match;

  const keepPrefix = 3;
  const keepSuffix = 4;
  const maskCount = digits.length - keepPrefix - keepSuffix;
  if (maskCount <= 0) return match;

  let digitIndex = 0;
  let masked = '';
  for (const ch of match) {
    if (/\d/.test(ch)) {
      if (digitIndex < keepPrefix || digitIndex >= keepPrefix + maskCount) {
        masked += ch;
      } else {
        masked += '*';
      }
      digitIndex++;
    } else {
      masked += ch;
    }
  }
  return masked;
}

function maskCreditCardMatch(match: string): string {
  const digits = match.replace(/\D/g, '');
  if (digits.length < 13) return match;

  const keepPrefix = 4;
  const keepSuffix = 4;
  const maskCount = digits.length - keepPrefix - keepSuffix;
  if (maskCount <= 0) return match;

  let digitIndex = 0;
  let masked = '';
  for (const ch of match) {
    if (/\d/.test(ch)) {
      if (digitIndex < keepPrefix || digitIndex >= keepPrefix + maskCount) {
        masked += ch;
      } else {
        masked += '*';
      }
      digitIndex++;
    } else {
      masked += ch;
    }
  }
  return masked;
}

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// 7-15 digit phone numbers with optional separators and country code
const PHONE_REGEX = /(?:\+?\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{2,4}[\s.-]?\d{4}\b/g;

// 13-19 digits optionally separated by spaces or dashes
const CREDIT_CARD_REGEX = /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{1,7}(?:[\s-]?\d{1,4})?\b/g;

const builtInPatterns: PiiPattern[] = [
  { name: 'email', regex: EMAIL_REGEX, mask: maskEmailMatch },
  { name: 'creditCard', regex: CREDIT_CARD_REGEX, mask: maskCreditCardMatch },
  { name: 'phone', regex: PHONE_REGEX, mask: maskPhoneMatch },
];

const customPatterns: PiiPattern[] = [];

export function addPiiPattern(pattern: PiiPattern): void {
  customPatterns.push(pattern);
}

export function maskPII(input: string): string {
  let result = input;
  const allPatterns = [...customPatterns, ...builtInPatterns];

  for (const { regex, mask } of allPatterns) {
    regex.lastIndex = 0;
    result = result.replace(regex, mask);
  }

  return result;
}

export function maskPiiInObject<T>(obj: T): T {
  if (typeof obj === 'string') return maskPII(obj) as T;
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map((item) => maskPiiInObject(item)) as T;

  if (typeof obj === 'object') {
    const masked: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      masked[key] = maskPiiInObject(value);
    }
    return masked as T;
  }

  return obj;
}
