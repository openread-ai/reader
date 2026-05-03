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
const artifactDir = resolve(config.attemptDir, 'test-plan');
const approval = String(args.approval ?? 'pending').toLowerCase();

if (!['approved', 'rejected', 'needs-revision', 'not-needed', 'pending'].includes(approval)) {
  fail('--approval must be approved, rejected, needs-revision, not-needed, or pending');
}

const tests = listArg(args.tests);
const unitTests = listArg(args.unitTests);
const integrationTests = listArg(args.integrationTests);
const e2eTests = listArg(args.e2eTests);
const existingTests = listArg(args.existingTests);
const testsToCreate = listArg(args.testsToCreate);
const testsToUpdate = listArg(args.testsToUpdate);
const testsToRemove = listArg(args.testsToRemove);
const commands = listArg(args.commands);
const leakCoverage = listArg(args.leakCoverage);
const testNonGoals = listArg(args.testNonGoals);
const testPriorities = listArg(args.testPriorities);
const minimalTestPolicy = {
  principle: 'Minimum sufficient tests, maximum leak coverage; do not optimize for test count.',
  preferExistingTests: true,
  requireReasonForNewTests: true,
  priorityOrder: [
    'end-to-end workflow integrity',
    'leak/failure-path coverage',
    'unit coverage for isolated logic',
  ],
  avoid: [
    'duplicate assertions',
    'branch-by-branch padding',
    'creating new files when existing tests can be extended',
  ],
};

if (testsToCreate.length > 0 && !String(args.reason ?? '').trim()) {
  fail(
    '--reason is required when --tests-to-create is provided; justify why existing tests are insufficient',
  );
}

ensureDir(artifactDir);

const report = {
  schemaVersion: 1,
  stage: 'test-case-planning',
  result: approval === 'rejected' || approval === 'needs-revision' ? 'failed' : 'partial',
  testApprovalStatus: approval,
  activityId: config.activityId,
  activityUuid: config.activityUuid,
  attemptId: config.attemptId,
  reviewer: args.reviewer ?? process.env.USER ?? 'unknown',
  source: args.source ?? 'intent',
  scope: args.scope ?? args.summary ?? 'Intent-level Test stage scope pending.',
  tests,
  unitTests,
  integrationTests,
  e2eTests,
  existingTests,
  testsToCreate,
  testsToUpdate,
  testsToRemove,
  commands,
  minimalTestPolicy,
  leakCoverage,
  testPriorities,
  testNonGoals,
  requiredPlatforms: config.platforms,
  reason: args.reason ?? '',
  artifactDir,
  nextAction:
    approval === 'approved' || approval === 'not-needed'
      ? 'Proceed with scoped implementation and validation using this test plan.'
      : 'Approve or revise intent-level Test scope before scoping, implementation, or validation.',
  startedAt,
  finishedAt: new Date().toISOString(),
  durationMs: Date.now() - startedAtMs,
  createdAt: startedAt,
};

writeJson(resolve(artifactDir, 'test-plan-report.json'), report);
console.log(JSON.stringify(report, null, 2));
process.exit(report.result === 'failed' ? 1 : 0);

function listArg(value) {
  return String(value ?? '')
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function printHelp() {
  console.log(`Activity test plan marker

Usage:
  pnpm activity:test-plan --activity <id> --attempt <id> --scope <text> [options]

Options:
  --tests <a|b|c>             Pipe-separated planned/created test files or cases
  --unit-tests <a|b|c>        Pipe-separated unit test scope
  --integration-tests <a|b|c> Pipe-separated integration/API test scope
  --e2e-tests <a|b|c>         Pipe-separated end-to-end test scope
  --existing-tests <a|b|c>    Pipe-separated existing tests reviewed
  --tests-to-create <a|b|c>   Pipe-separated tests to create
  --tests-to-update <a|b|c>   Pipe-separated tests to update
  --tests-to-remove <a|b|c>   Pipe-separated out-of-scope tests to remove
  --commands <a|b|c>          Pipe-separated validation commands
  --leak-coverage <a|b|c>     Pipe-separated leak/failure paths that must be covered
  --test-priorities <a|b|c>   Pipe-separated testing priorities, highest value first
  --test-non-goals <a|b|c>    Pipe-separated tests explicitly not worth creating
  --approval <status>         pending|approved|rejected|needs-revision|not-needed
  --source <name>             intent, notion, chat, local, or reviewer
  --reviewer <name>           Reviewer or agent recording Test stage approval
  --reason <text>             Short rationale
`);
}
