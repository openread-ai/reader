#!/usr/bin/env node
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
const artifactDir = config.stage8Dir;
const verdict = String(args.verdict ?? '').toLowerCase();

if (!['approved', 'rejected', 'needs-revision'].includes(verdict)) {
  fail('--verdict must be approved, rejected, or needs-revision');
}

ensureDir(artifactDir);

const report = {
  schemaVersion: 1,
  stage: 'validation-verdict',
  result: verdict === 'approved' ? 'passed' : 'failed',
  verdict,
  activityId: config.activityId,
  activityUuid: config.activityUuid,
  attemptId: config.attemptId,
  reviewer: args.reviewer ?? process.env.USER ?? 'unknown',
  reason: args.reason ?? '',
  artifactDir,
  nextAction:
    verdict === 'approved'
      ? 'Proceed to final sync, PR checks, simplify/security review, and handoff.'
      : 'Revise implementation or design, then rerun validation.',
  startedAt,
  finishedAt: new Date().toISOString(),
  durationMs: Date.now() - startedAtMs,
  createdAt: startedAt,
};

writeJson(resolve(artifactDir, 'validation-verdict.json'), report);
console.log(JSON.stringify(report, null, 2));
process.exit(report.result === 'failed' ? 1 : 0);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function printHelp() {
  console.log(`Activity validation verdict

Usage:
  pnpm activity:validation-verdict --activity <id> --attempt <id> --verdict approved|rejected|needs-revision [options]

Options:
  --reviewer <name>  Reviewer or agent recording the verdict
  --reason <text>    Short rationale or required revision
`);
}
