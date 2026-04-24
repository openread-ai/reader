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
const artifactDir = resolve(config.attemptDir, 'approval');
const approval = String(args.approval ?? '').toLowerCase();

if (!['approved', 'rejected', 'needs-revision', 'not-needed'].includes(approval)) {
  fail('--approval must be approved, rejected, needs-revision, or not-needed');
}

ensureDir(artifactDir);

const report = {
  schemaVersion: 1,
  stage: 'approval',
  result: approval === 'approved' || approval === 'not-needed' ? 'passed' : 'failed',
  approvalStatus: approval,
  activityId: config.activityId,
  activityUuid: config.activityUuid,
  attemptId: config.attemptId,
  reviewer: args.reviewer ?? process.env.USER ?? 'unknown',
  source: args.source ?? 'notion',
  figmaUrl: args.figmaUrl ?? null,
  notionUrl: args.notionUrl ?? null,
  approvedLocal: args.approvedLocal ?? null,
  reason: args.reason ?? '',
  artifactDir,
  nextAction:
    approval === 'approved' || approval === 'not-needed'
      ? 'Proceed to implementation marker and implementation work.'
      : 'Revise design/current capture before implementation.',
  startedAt,
  finishedAt: new Date().toISOString(),
  durationMs: Date.now() - startedAtMs,
  createdAt: startedAt,
};

writeJson(resolve(artifactDir, 'approval-report.json'), report);
console.log(JSON.stringify(report, null, 2));
process.exit(report.result === 'failed' ? 1 : 0);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function printHelp() {
  console.log(`Activity approval marker

Usage:
  pnpm activity:approval --activity <id> --attempt <id> --approval approved|rejected|needs-revision|not-needed [options]

Options:
  --source <name>              notion, figma, intent, local, or reviewer
  --figma-url <url>            Approved Figma design URL
  --notion-url <url>           Approved Notion artifact URL
  --approved-local <path>      Local approved screenshot/artifact path
  --reviewer <name>            Reviewer or agent recording approval
  --reason <text>              Short approval or revision rationale
`);
}
