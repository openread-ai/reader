#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ensureDir, getActivityConfig, parseArgs, writeJson } from './common.mjs';

const args = parseArgs(process.argv.slice(2));
const config = getActivityConfig(process.argv.slice(2));
const startedAtMs = Date.now();
const startedAt = new Date(startedAtMs).toISOString();
const appRoot = process.cwd();
const repoRoot = resolve(appRoot, '../..');
const bootstrapDir = resolve(config.attemptDir, 'bootstrap');
const steps = [];

ensureDir(bootstrapDir);

runStep({
  name: 'submodules',
  command: 'git',
  args: ['submodule', 'update', '--init', '--recursive'],
  cwd: repoRoot,
  skip: existsSync(resolve(repoRoot, 'packages/foliate-js/package.json')),
});

runStep({
  name: 'pnpm-install',
  command: 'pnpm',
  args: ['install', '--prefer-offline'],
  cwd: repoRoot,
  skip: existsSync(resolve(appRoot, 'node_modules')) && args.force !== true,
});

runStep({
  name: 'setup-vendors',
  command: 'pnpm',
  args: ['--filter', '@openread/openread-app', 'setup-vendors'],
  cwd: repoRoot,
  skip: vendorAssetsReady(appRoot) && args.force !== true,
});

runStep({
  name: 'playwright-install-webkit-chromium',
  command: 'pnpm',
  args: [
    '--filter',
    '@openread/openread-app',
    'exec',
    'playwright',
    'install',
    'chromium',
    'webkit',
  ],
  cwd: repoRoot,
  skip: args.skipPlaywright === true,
});

if (args.includeMsedge === true) {
  runStep({
    name: 'playwright-install-msedge',
    command: 'pnpm',
    args: ['--filter', '@openread/openread-app', 'exec', 'playwright', 'install', 'msedge'],
    cwd: repoRoot,
  });
}

const failed = steps.filter((step) => step.result === 'failed');
const report = {
  schemaVersion: 1,
  stage: 'activity-bootstrap',
  result: failed.length > 0 ? 'failed' : 'passed',
  activityId: config.activityId,
  activityUuid: config.activityUuid,
  attemptId: config.attemptId,
  artifactDir: bootstrapDir,
  steps,
  nextAction:
    failed.length > 0
      ? 'Fix failed bootstrap step, then retry bootstrap with a new attempt or --force.'
      : 'Run Stage 3 readiness check.',
  startedAt,
  finishedAt: new Date().toISOString(),
  durationMs: Date.now() - startedAtMs,
  createdAt: startedAt,
};

writeJson(resolve(bootstrapDir, 'bootstrap-report.json'), report);
console.log(JSON.stringify(report, null, 2));

if (failed.length > 0) process.exit(1);

function vendorAssetsReady(root) {
  return [
    'public/vendor/pdfjs/pdf.min.mjs',
    'public/vendor/pdfjs/pdf.worker.min.mjs',
    'public/vendor/pdfjs/openjpeg.wasm',
    'public/vendor/simplecc/simplecc_wasm.js',
    'public/vendor/simplecc/simplecc_wasm_bg.wasm',
  ].every((relativePath) => existsSync(resolve(root, relativePath)));
}

function runStep({ name, command, args: commandArgs, cwd, skip = false }) {
  if (skip) {
    steps.push({ name, result: 'skipped', reason: 'already satisfied', durationMs: 0 });
    return;
  }

  const stepStartedAtMs = Date.now();
  const stepStartedAt = new Date(stepStartedAtMs).toISOString();
  const result = spawnSync(command, commandArgs, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  steps.push({
    name,
    result: result.status === 0 ? 'passed' : 'failed',
    command: `${command} ${commandArgs.join(' ')}`,
    cwd,
    exitCode: result.status,
    stdout: trimOutput(result.stdout),
    stderr: trimOutput(result.stderr),
    startedAt: stepStartedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - stepStartedAtMs,
  });
}

function trimOutput(value) {
  const text = String(value ?? '').trim();
  return text.length > 4_000 ? `${text.slice(0, 4_000)}\n...[truncated]` : text;
}
