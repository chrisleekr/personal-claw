import { describe, expect, test } from 'bun:test';
import type { SandboxConfig } from '@personalclaw/shared';
import {
  buildSandboxEnv,
  SAFE_ENV_VARS,
  SandboxCommandValidator,
  validateGitTokenEnvVar,
  validateSandboxPath,
} from '../security';

const baseConfig: SandboxConfig = {
  allowedCommands: ['bash', 'sh', 'git', 'ls', 'cat', 'echo', 'python3', 'node'],
  deniedPatterns: ['rm -rf /', 'mkfs', 'dd if='],
  maxExecutionTimeS: 60,
  maxWorkspaceSizeMb: 256,
  networkAccess: true,
  gitTokenEnvVar: null,
};

describe('SandboxCommandValidator', () => {
  const validator = new SandboxCommandValidator(baseConfig);

  describe('allowed commands', () => {
    test('allows listed commands', () => {
      expect(validator.validateCommand('ls -la')).toEqual({ valid: true });
      expect(validator.validateCommand('git status')).toEqual({ valid: true });
      expect(validator.validateCommand('cat file.txt')).toEqual({ valid: true });
      expect(validator.validateCommand('echo hello')).toEqual({ valid: true });
    });

    test('allows commands with arguments', () => {
      expect(validator.validateCommand('git clone https://github.com/org/repo.git')).toEqual({
        valid: true,
      });
    });

    test('blocks unlisted commands', () => {
      const result = validator.validateCommand('wget http://evil.com');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain('wget');
        expect(result.reason).toContain('not in the allowed list');
      }
    });
  });

  describe('shell metacharacters', () => {
    test('blocks semicolons', () => {
      const result = validator.validateCommand('ls; rm -rf /');
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toContain('metacharacters');
    });

    test('blocks pipes', () => {
      const result = validator.validateCommand('cat file | grep secret');
      expect(result.valid).toBe(false);
    });

    test('blocks ampersands', () => {
      const result = validator.validateCommand('ls & cat /etc/passwd');
      expect(result.valid).toBe(false);
    });

    test('blocks backticks', () => {
      const result = validator.validateCommand('echo `whoami`');
      expect(result.valid).toBe(false);
    });

    test('blocks dollar signs', () => {
      const result = validator.validateCommand('echo $HOME');
      expect(result.valid).toBe(false);
    });

    test('blocks command substitution', () => {
      const result = validator.validateCommand('echo $(id)');
      expect(result.valid).toBe(false);
    });
  });

  describe('denied patterns', () => {
    test('blocks rm -rf /', () => {
      const result = validator.validateCommand('bash rm -rf /');
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toContain('denied pattern');
    });

    test('blocks mkfs', () => {
      const result = validator.validateCommand('bash mkfs.ext4 /dev/sda1');
      expect(result.valid).toBe(false);
    });

    test('blocks dd if=', () => {
      const result = validator.validateCommand('bash dd if=/dev/zero of=/dev/sda');
      expect(result.valid).toBe(false);
    });
  });

  describe('edge cases', () => {
    test('rejects empty commands', () => {
      const result = validator.validateCommand('');
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toBe('Empty command');
    });

    test('rejects whitespace-only commands', () => {
      const result = validator.validateCommand('   ');
      expect(result.valid).toBe(false);
    });

    test('handles commands with paths', () => {
      expect(validator.validateCommand('/usr/bin/git status')).toEqual({ valid: true });
    });
  });
});

describe('validateSandboxPath', () => {
  const workspace = '/tmp/sandbox-123/workspace';

  test('allows simple relative paths', () => {
    expect(validateSandboxPath('file.txt', workspace)).toEqual({ valid: true });
    expect(validateSandboxPath('src/main.py', workspace)).toEqual({ valid: true });
    expect(validateSandboxPath('a/b/c/d.ts', workspace)).toEqual({ valid: true });
  });

  test('rejects empty paths', () => {
    const result = validateSandboxPath('', workspace);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('Empty path');
  });

  test('rejects absolute paths', () => {
    const result = validateSandboxPath('/etc/passwd', workspace);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toContain('Absolute paths');
  });

  test('rejects directory traversal with ..', () => {
    const result = validateSandboxPath('../../../etc/passwd', workspace);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toContain('traversal');
  });

  test('rejects sneaky traversal mid-path', () => {
    const result = validateSandboxPath('foo/../../etc/passwd', workspace);
    expect(result.valid).toBe(false);
  });

  test('allows dot-prefixed filenames', () => {
    expect(validateSandboxPath('.gitignore', workspace)).toEqual({ valid: true });
    expect(validateSandboxPath('.env', workspace)).toEqual({ valid: true });
  });

  test('allows current directory references', () => {
    expect(validateSandboxPath('./file.txt', workspace)).toEqual({ valid: true });
  });
});

describe('buildSandboxEnv', () => {
  test('returns only allowlisted host vars when no extras provided', () => {
    const env = buildSandboxEnv();
    const keys = Object.keys(env);
    for (const key of keys) {
      expect(SAFE_ENV_VARS).toContain(key);
    }
  });

  test('includes provider envVars and caller options.env alongside allowlisted vars', () => {
    const env = buildSandboxEnv({ PROVIDER_VAR: 'prov' }, { CALLER_VAR: 'call' });
    expect(env.PROVIDER_VAR).toBe('prov');
    expect(env.CALLER_VAR).toBe('call');
  });

  test('allows options.env to override allowlisted values', () => {
    const env = buildSandboxEnv(undefined, { PATH: '/custom/path' });
    expect(env.PATH).toBe('/custom/path');
  });

  test('excludes sensitive vars even when set on host', () => {
    const originalDb = Bun.env.DATABASE_URL;
    const originalOpenai = Bun.env.OPENAI_API_KEY;
    const originalAws = Bun.env.AWS_SECRET_ACCESS_KEY;
    Bun.env.DATABASE_URL = 'postgres://secret';
    Bun.env.OPENAI_API_KEY = 'sk-secret';
    Bun.env.AWS_SECRET_ACCESS_KEY = 'aws-secret';

    try {
      const env = buildSandboxEnv();
      expect(env.DATABASE_URL).toBeUndefined();
      expect(env.OPENAI_API_KEY).toBeUndefined();
      expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    } finally {
      if (originalDb === undefined) delete Bun.env.DATABASE_URL;
      else Bun.env.DATABASE_URL = originalDb;
      if (originalOpenai === undefined) delete Bun.env.OPENAI_API_KEY;
      else Bun.env.OPENAI_API_KEY = originalOpenai;
      if (originalAws === undefined) delete Bun.env.AWS_SECRET_ACCESS_KEY;
      else Bun.env.AWS_SECRET_ACCESS_KEY = originalAws;
    }
  });

  test('handles missing allowlisted vars gracefully', () => {
    const originalLang = Bun.env.LANG;
    delete Bun.env.LANG;

    try {
      const env = buildSandboxEnv();
      expect(env.LANG).toBeUndefined();
    } finally {
      if (originalLang !== undefined) Bun.env.LANG = originalLang;
    }
  });

  test('allows provider envVars to override allowlisted values when they collide', () => {
    const env = buildSandboxEnv({ PATH: '/provider/path' });
    expect(env.PATH).toBe('/provider/path');
  });
});

describe('validateGitTokenEnvVar', () => {
  test('accepts allowed token variable names', () => {
    expect(() => validateGitTokenEnvVar('GH_TOKEN')).not.toThrow();
    expect(() => validateGitTokenEnvVar('GITHUB_TOKEN')).not.toThrow();
    expect(() => validateGitTokenEnvVar('GIT_TOKEN')).not.toThrow();
    expect(() => validateGitTokenEnvVar('GITLAB_TOKEN')).not.toThrow();
  });

  test('throws for disallowed variable names', () => {
    expect(() => validateGitTokenEnvVar('DATABASE_URL')).toThrow('not allowed');
    expect(() => validateGitTokenEnvVar('AWS_SECRET_ACCESS_KEY')).toThrow('not allowed');
    expect(() => validateGitTokenEnvVar('SOME_RANDOM_VAR')).toThrow('not allowed');
  });

  test('accepts null and empty string as no-op', () => {
    expect(() => validateGitTokenEnvVar(null)).not.toThrow();
    expect(() => validateGitTokenEnvVar('')).not.toThrow();
    expect(() => validateGitTokenEnvVar(undefined)).not.toThrow();
  });
});

describe('buildSandboxEnv parity', () => {
  test('produces identical output regardless of calling context (SC-004)', () => {
    const envA = buildSandboxEnv({ GH_TOKEN: 'token123' }, { CUSTOM: 'val' });
    const envB = buildSandboxEnv({ GH_TOKEN: 'token123' }, { CUSTOM: 'val' });
    expect(envA).toEqual(envB);
  });
});
