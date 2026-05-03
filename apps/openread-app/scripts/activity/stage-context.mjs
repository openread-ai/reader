#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  getActivityConfig,
  loadActivityEnv,
  parseArgs,
  readJsonIfExists,
  writeJson,
} from './common.mjs';

const STAGE_EXPECTATIONS = {
  intake: {
    allowedInputs: ['intent', 'activity-id'],
    expectedOutput: 'Canonical Notion Activity Log row and Activity Event exist before mutation.',
    nextStage: 'Design Source or Test',
  },
  'design-source': {
    allowedInputs: ['activity-log', 'activity-events', 'design-links'],
    expectedOutput: 'Design source identified, or explicitly marked not-needed with rationale.',
    nextStage: 'Test',
  },
  test: {
    allowedInputs: ['activity-log', 'activity-events', 'intent'],
    expectedOutput:
      'Approved lean test scope before implementation: prefer existing tests, cover leak/failure paths, avoid duplicate test-count padding.',
    nextStage: 'Scoping',
  },
  'test-case-planning': {
    allowedInputs: ['activity-log', 'activity-events', 'intent'],
    expectedOutput:
      'Approved lean test scope before implementation: prefer existing tests, cover leak/failure paths, avoid duplicate test-count padding.',
    nextStage: 'Scoping',
  },
  'test-approval': {
    allowedInputs: ['activity-log', 'activity-events', 'test-plan'],
    expectedOutput: 'Approved/not-needed test status recorded before scoping/capture.',
    nextStage: 'Scoping',
  },
  scoping: {
    allowedInputs: ['activity-log', 'activity-events', 'intent', 'test-plan'],
    expectedOutput: 'Capture/scope plan only; no implementation changes.',
    nextStage: 'Setup',
  },
  setup: {
    allowedInputs: ['activity-log', 'activity-events', 'scope-plan'],
    expectedOutput: 'Dependencies/tooling/vendor setup complete or blocker recorded.',
    nextStage: 'Readiness',
  },
  readiness: {
    allowedInputs: ['activity-log', 'activity-events', 'scope-plan', 'setup-report'],
    expectedOutput: 'Platform readiness checks pass for selected lanes.',
    nextStage: 'Current Capture',
  },
  'current-capture': {
    allowedInputs: ['activity-log', 'activity-events', 'readiness-report'],
    expectedOutput: 'Current-state evidence captured before mutation.',
    nextStage: 'Design Approval Gate',
  },
  'design-approval-gate': {
    allowedInputs: ['activity-log', 'activity-events', 'current-capture-evidence'],
    expectedOutput: 'Approval status recorded; implementation blocked unless approved/not-needed.',
    nextStage: 'Implementation',
  },
  implementation: {
    allowedInputs: ['activity-log', 'activity-events', 'approval', 'approved-test-plan'],
    expectedOutput:
      'Scoped code/test changes only; extend existing tests when possible and create only justified leak-covering tests.',
    nextStage: 'Validation',
  },
  validation: {
    allowedInputs: ['activity-log', 'activity-events', 'implementation-commit'],
    expectedOutput: 'Targeted tests/captures prove the implementation result.',
    nextStage: 'Validation Verdict',
  },
  'validation-verdict': {
    allowedInputs: ['activity-log', 'activity-events', 'validation-evidence'],
    expectedOutput:
      'Intent-adherence verdict: confirm the real test cases ran, evidence covers the approved scope, implementation aligns with Activity intent, and carry forward any questions.',
    nextStage: 'Final Quality Gate',
  },
  'final-quality': {
    allowedInputs: ['activity-log', 'activity-events', 'validation-verdict'],
    expectedOutput: 'Required lint/test/build gates summarized; skipped checks justified.',
    nextStage: 'Final Hygiene / Cleanup Gate',
  },
  'final-hygiene': {
    allowedInputs: ['activity-log', 'activity-events', 'quality-report'],
    expectedOutput: 'Clean git/process/artifact handoff state.',
    nextStage: 'PR Review / Handoff',
  },
  'pr-handoff': {
    allowedInputs: ['activity-log', 'activity-events', 'quality-report', 'hygiene-report'],
    expectedOutput: 'PR URL/checks/review status and pickup summary recorded.',
    nextStage: 'Final Sync / Close Activity',
  },
  'final-sync-close': {
    allowedInputs: ['activity-log', 'activity-events', 'pr-handoff'],
    expectedOutput: 'Activity final state closed/merged/cancelled with durable pickup summary.',
    nextStage: 'Done',
  },
};

loadActivityEnv();
const args = parseArgs(process.argv.slice(2));
const config = getActivityConfig(process.argv.slice(2));
const stage = normalizeStage(args.stage ?? args.currentStage ?? 'intake');
const mode = args.mode === 'continuous' ? 'continuous' : 'discrete';
const artifactRoot = resolve(
  args.artifactRoot ??
    process.env.OPENREAD_ACTIVITY_ARTIFACT_ROOT ??
    resolve(homedir(), '.openread-dev/activity-artifacts'),
);
const notionConfig = readJsonIfExists(resolveNotionConfigPath(artifactRoot));
const activityLogDatabaseId =
  args.database ??
  process.env.OPENREAD_NOTION_ACTIVITY_LOG_DATABASE ??
  notionConfig?.activityLogDatabaseId;
const notionToken = process.env.NOTION_TOKEN ?? process.env.NOTION_API_KEY;

if (!config.activityId || config.activityId === 'sandbox-activity') {
  fail('Activity ID is required. Run /start-dev first and pass --activity ACT-...');
}

const expectations = STAGE_EXPECTATIONS[stage];
if (!expectations) fail(`Unknown stage: ${stage}`);
if (!activityLogDatabaseId)
  fail('Activity Log database ID is required. Run activity:notion-create-log first.');
if (!notionToken) fail('NOTION_TOKEN or NOTION_API_KEY is required to read Activity Log context.');

const activityPage = await findActivityPage({
  notionToken,
  databaseId: activityLogDatabaseId,
  activityId: config.activityId,
});
if (!activityPage)
  fail(`Activity Log row not found for ${config.activityId}. Run /start-dev first.`);

const context = {
  schemaVersion: 1,
  stage: 'stage-context',
  result: 'passed',
  mode,
  activityId: config.activityId,
  activityUuid: config.activityUuid,
  attemptId: config.attemptId,
  requestedStage: stage,
  notionActivityPageId: activityPage.id,
  notionActivityPageUrl: activityPage.url,
  current: {
    status: selectName(activityPage.properties?.Status),
    currentStage: richTextValue(activityPage.properties?.['Current Stage']),
    approvalStatus: selectName(activityPage.properties?.['Approval Status']),
    latestAttempt: richTextValue(activityPage.properties?.['Latest Attempt']),
    nextAction: richTextValue(activityPage.properties?.['Next Action']),
    blockedBy: richTextValue(activityPage.properties?.['Blocked By']),
    branch: richTextValue(activityPage.properties?.Branch),
    prUrl: activityPage.properties?.['PR URL']?.url ?? null,
  },
  expectations,
  git: gitSummary(),
  createdAt: new Date().toISOString(),
  nextAction: `Run only ${stage} tasks, then write an Activity Event and update Activity Log.`,
};

const outDir = resolve(config.attemptDir, 'stage-context');
writeJson(resolve(outDir, `${stage}-context.json`), context);
console.log(JSON.stringify(context, null, 2));

function normalizeStage(value) {
  return String(value).toLowerCase().trim().replace(/\s+/g, '-').replace(/_/g, '-');
}

function resolveNotionConfigPath(root) {
  const localPath = resolve(root, 'notion-activity-log.json');
  if (existsSync(localPath)) return localPath;
  return resolve(homedir(), '.openread-dev/activity-artifacts/notion-activity-log.json');
}

async function findActivityPage({ notionToken, databaseId, activityId }) {
  const result = await notionRequest({
    notionToken,
    path: `/v1/databases/${normalizeNotionId(databaseId)}/query`,
    method: 'POST',
    body: { filter: { property: 'Activity ID', rich_text: { equals: activityId } }, page_size: 1 },
  });
  return result.results?.[0] ?? null;
}

async function notionRequest({ notionToken, path, method, body }) {
  const res = await fetch(`https://api.notion.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${notionToken}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok)
    throw new Error(`Notion request failed: ${method} ${path} ${res.status} ${await res.text()}`);
  return res.json();
}

function normalizeNotionId(value) {
  return String(value).replace(/-/g, '').trim();
}

function richTextValue(property) {
  return property?.rich_text?.map((part) => part.plain_text ?? '').join('') ?? '';
}

function selectName(property) {
  return property?.select?.name ?? '';
}

function gitSummary() {
  return {
    branch: runGit(['branch', '--show-current']),
    head: runGit(['rev-parse', '--short', 'HEAD']),
    clean: runGit(['status', '--short']) === '',
  };
}

function runGit(argv) {
  const result = spawnSync('git', argv, { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
