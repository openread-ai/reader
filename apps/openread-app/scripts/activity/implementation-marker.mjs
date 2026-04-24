#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { ensureDir, getActivityConfig, parseArgs, writeJson } from './common.mjs';

const argv = process.argv.slice(2);
const args = parseArgs(argv);
if (args.help || args.h) {
  printHelp();
  process.exit(0);
}

const config = getActivityConfig(argv);
const startedAtMs = Date.now();
const startedAt = new Date(startedAtMs).toISOString();
const artifactDir = resolve(config.attemptDir, 'implementation');
const status = String(args.status ?? 'started');

if (!['started', 'completed', 'blocked'].includes(status)) {
  fail('--status must be started, completed, or blocked');
}

ensureDir(artifactDir);

const report = {
  schemaVersion: 1,
  stage: 'implementation',
  result: status === 'blocked' ? 'failed' : 'passed',
  implementationStatus: status,
  activityId: config.activityId,
  activityUuid: config.activityUuid,
  attemptId: config.attemptId,
  summary: args.summary ?? process.env.OPENREAD_ACTIVITY_IMPLEMENTATION_SUMMARY ?? '',
  prUrl: args.prUrl ?? process.env.OPENREAD_ACTIVITY_PR_URL ?? null,
  git: gitSummary(),
  artifactDir,
  nextAction: nextAction(status),
  startedAt,
  finishedAt: new Date().toISOString(),
  durationMs: Date.now() - startedAtMs,
  createdAt: startedAt,
};

writeJson(resolve(artifactDir, 'implementation-report.json'), report);
console.log(JSON.stringify(report, null, 2));
process.exit(report.result === 'failed' ? 1 : 0);

function nextAction(value) {
  if (value === 'started') return 'Continue implementation; mark completed before validation.';
  if (value === 'completed') return 'Run Stage 8 validation against approved sources.';
  return 'Resolve implementation blocker before validation.';
}

function gitSummary() {
  return {
    branch: git(['branch', '--show-current']),
    head: git(['rev-parse', '--short', 'HEAD']),
    clean: git(['status', '--short']) === '',
    commits: git(['log', '--oneline', '--decorate', '-10']),
  };
}

function git(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function printHelp() {
  console.log(`Activity implementation marker

Usage:
  pnpm activity:implementation --activity <id> --attempt <id> --status started|completed|blocked [options]

Options:
  --summary <text>    Short implementation summary for handoff
  --pr-url <url>      GitHub PR URL when available
`);
}
