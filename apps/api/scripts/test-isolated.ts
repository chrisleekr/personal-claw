/**
 * Per-file test runner that works around Bun's mock.module() leaking
 * between test files in the same process (oven-sh/bun#12823).
 *
 * Runs each test file in its own `bun test` subprocess so module mocks
 * cannot pollute other files. Files execute in parallel batches for speed.
 *
 * Remove this once Bun ships proper mock.module scoping.
 */

import { Glob } from 'bun';

const CONCURRENCY = Number(process.env.TEST_CONCURRENCY) || 4;

const glob = new Glob('src/**/*.test.{ts,tsx}');
const files: string[] = [];
for await (const file of glob.scan({ cwd: `${import.meta.dir}/..`, absolute: false })) {
  files.push(file);
}
files.sort();

if (files.length === 0) {
  console.log('No test files found.');
  process.exit(0);
}

console.log(`Running ${files.length} test files (concurrency: ${CONCURRENCY})\n`);

let passed = 0;
let failed = 0;
const failures: { file: string; output: string }[] = [];

for (let i = 0; i < files.length; i += CONCURRENCY) {
  const batch = files.slice(i, i + CONCURRENCY);

  const results = await Promise.all(
    batch.map(async (file) => {
      const proc = Bun.spawn(['bun', 'test', file], {
        cwd: `${import.meta.dir}/..`,
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env },
      });

      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      const exitCode = await proc.exited;

      return { file, exitCode, stdout, stderr };
    }),
  );

  for (const r of results) {
    if (r.exitCode === 0) {
      passed++;
    } else {
      failed++;
      failures.push({ file: r.file, output: r.stdout + r.stderr });
      console.error(`FAIL  ${r.file}`);
    }
  }
}

if (failures.length > 0) {
  console.error(`\n${'='.repeat(60)}`);
  console.error('FAILURE DETAILS\n');
  for (const f of failures) {
    console.error(`--- ${f.file} ---`);
    console.error(f.output);
  }
}

console.log(`\n${passed} passed, ${failed} failed (${files.length} files)`);
process.exit(failed > 0 ? 1 : 0);
