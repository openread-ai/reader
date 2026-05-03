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
const artifactDir = resolve(config.attemptDir, 'test-approval');
const approval = String(args.approval ?? '').toLowerCase();

if (!['approved', 'rejected', 'needs-revision', 'not-needed', 'pending'].includes(approval)) {
  fail('--approval must be approved, rejected, needs-revision, not-needed, or pending');
}

ensureDir(artifactDir);

const report = {
  schemaVersion: 1,
  stage: 'test-approval',
  result: approval === 'approved' || approval === 'not-needed' ? 'passed' : 'partial',
  testApprovalStatus: approval,
  activityId: config.activityId,
  activityUuid: config.activityUuid,
  attemptId: config.attemptId,
  reviewer: args.reviewer ?? process.env.USER ?? 'unknown',
  source: args.source ?? 'reviewer',
  testPlanUrl: args.testPlanUrl ?? null,
  notionUrl: args.notionUrl ?? null,
  approvedLocal: args.approvedLocal ?? null,
  reason: args.reason ?? '',
  artifactDir,
  nextAction:
    approval === 'approved' || approval === 'not-needed'
      ? 'Proceed with implementation or validation using approved test scope.'
      : 'Revise or approve intent-level Test scope before scoping, implementation, or validation.',
  startedAt,
  finishedAt: new Date().toISOString(),
  durationMs: Date.now() - startedAtMs,
  createdAt: startedAt,
};

writeJson(resolve(artifactDir, 'test-approval-report.json'), report);
console.log(JSON.stringify(report, null, 2));
process.exit(report.result === 'failed' ? 1 : 0);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function printHelp() {
  console.log(`Activity test approval marker

Usage:
  pnpm activity:test-approval --activity <id> --attempt <id> --approval approved|rejected|needs-revision|not-needed|pending [options]

Options:
  --source <name>              notion, chat, local, or reviewer
  --test-plan-url <url>        Approved test plan URL
  --notion-url <url>           Approved Notion artifact URL
  --approved-local <path>      Local approved test plan/evidence path
  --reviewer <name>            Reviewer or agent recording Test stage approval
  --reason <text>              Short approval or revision rationale
`);
}
