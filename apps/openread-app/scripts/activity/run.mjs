#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import {
  ensureDir,
  getActivityConfig,
  loadActivityEnv,
  parseArgs,
  readJsonIfExists,
  writeJson,
} from './common.mjs';

loadActivityEnv();

const argv = process.argv.slice(2);
const args = parseArgs(argv);
if (args.help || args.h) {
  printHelp();
  process.exit(0);
}

const config = getActivityConfig(argv);
const startedAtMs = Date.now();
const startedAt = new Date(startedAtMs).toISOString();
const dryRun = String(args.dryRun ?? 'false') === 'true';
const artifactDir = resolve(config.attemptDir, 'activity-run');
const notionState = await loadNotionState();

ensureDir(artifactDir);

const state = loadState();
const decision = decideNext(state, notionState);
const execution = decision.command ? runDecision(decision) : null;
const result =
  execution?.exitCode === undefined || execution.exitCode === 0 ? decision.result : 'failed';
const report = {
  schemaVersion: 1,
  stage: 'activity-run',
  result,
  mode: dryRun ? 'dry-run' : 'execute',
  activityId: config.activityId,
  activityUuid: config.activityUuid,
  attemptId: config.attemptId,
  artifactDir,
  notion: notionState,
  decision,
  execution,
  startedAt,
  finishedAt: new Date().toISOString(),
  durationMs: Date.now() - startedAtMs,
  createdAt: startedAt,
};

writeJson(resolve(artifactDir, 'activity-run-report.json'), report);
console.log(JSON.stringify(report, null, 2));
process.exit(result === 'failed' ? 1 : 0);

function loadState() {
  return {
    activity: readJsonIfExists(resolve(config.activityDir, 'activity.json')),
    capturePlan: readJsonIfExists(config.capturePlanPath),
    bootstrap: readJsonIfExists(resolve(config.attemptDir, 'bootstrap/bootstrap-report.json')),
    stage3: readJsonIfExists(
      resolve(config.attemptDir, 'stage-3-platform-test/platform-test-report.json'),
    ),
    stage4: readJsonIfExists(resolve(config.stage4Dir, 'current-capture-report.json')),
    approval: readJsonIfExists(resolve(config.attemptDir, 'approval/approval-report.json')),
    implementation: readJsonIfExists(
      resolve(config.attemptDir, 'implementation/implementation-report.json'),
    ),
    stage8: readJsonIfExists(resolve(config.stage8Dir, 'validation-report.json')),
    validationVerdict: readJsonIfExists(resolve(config.stage8Dir, 'validation-verdict.json')),
  };
}

async function loadNotionState() {
  const notionToken = process.env.NOTION_TOKEN ?? process.env.NOTION_API_KEY;
  const notionConfig =
    readJsonIfExists(resolve(config.artifactRoot, 'notion-activity-log.json')) ??
    readJsonIfExists(
      resolve(homedir(), '.openread-dev/activity-artifacts/notion-activity-log.json'),
    );
  const databaseId = args.notionDatabase ?? notionConfig?.activityLogDatabaseId;
  if (!notionToken || !databaseId) return { mode: 'unavailable' };

  const page = await notionRequest({
    notionToken,
    path: `/v1/databases/${normalizeNotionId(databaseId)}/query`,
    method: 'POST',
    body: {
      filter: { property: 'Activity ID', rich_text: { equals: config.activityId } },
      page_size: 1,
    },
  });
  const result = page.results?.[0] ?? null;
  if (!result) return { mode: 'available', result: 'not-found' };

  return {
    mode: 'available',
    result: 'found',
    pageId: result.id,
    url: result.url,
    status: selectName(result.properties?.Status),
    currentStage: richTextValue(result.properties?.['Current Stage']),
    approvalStatus: selectName(result.properties?.['Approval Status']),
    latestAttempt: richTextValue(result.properties?.['Latest Attempt']),
    nextAction: richTextValue(result.properties?.['Next Action']),
  };
}

function decideNext(state, notion) {
  if (!state.activity) {
    return stop('failed', 'Activity metadata is missing. Run activity:init first.');
  }

  if (notion?.approvalStatus && !['Not Needed', 'Approved'].includes(notion.approvalStatus)) {
    return stop(
      notion.approvalStatus === 'Pending' ? 'partial' : 'failed',
      `Notion approval status is ${notion.approvalStatus}. Do not proceed until approval changes.`,
    );
  }

  if (!state.capturePlan) {
    if (!args.intent) {
      return stop('partial', 'Capture plan is missing. Provide --intent to create it.');
    }
    return command('capture-planning', 'Create capture plan from activity intent.', [
      'scripts/activity/plan-capture.mjs',
      ...forwardArgs(),
    ]);
  }

  if (!passed(state.bootstrap)) {
    if (state.bootstrap?.result === 'failed') {
      return stop('failed', 'Bootstrap failed. Fix bootstrap output before resuming.');
    }
    return command('activity-bootstrap', 'Run dependency/tooling bootstrap.', [
      'scripts/activity/bootstrap.mjs',
      ...forwardArgs(),
    ]);
  }

  if (!acceptable(state.stage3)) {
    if (state.stage3?.result === 'failed') {
      return stop('failed', 'Stage 3 platform test failed. Fix platform readiness first.');
    }
    return command('stage-3-platform-test', 'Run platform test/readiness lanes.', [
      'scripts/activity/stage3-platform-test.mjs',
      ...forwardArgs(),
    ]);
  }

  if (!acceptable(state.stage4)) {
    if (state.stage4?.result === 'failed') {
      return stop('failed', 'Stage 4 current capture failed. Fix capture lane first.');
    }
    return command('stage-4-current-capture', 'Run current-state capture.', [
      'scripts/activity/stage4-current-capture.mjs',
      ...forwardArgs(),
    ]);
  }

  if (!state.approval) {
    if (notion?.approvalStatus === 'Approved') {
      return command('approval', 'Record Notion approval locally before implementation.', [
        'scripts/activity/approval-marker.mjs',
        ...forwardArgs(),
        '--approval',
        'approved',
        '--source',
        'notion',
        ...(notion.url ? ['--notion-url', notion.url] : []),
      ]);
    }
    if (args.approval) {
      return command('approval', 'Record explicit approval decision.', [
        'scripts/activity/approval-marker.mjs',
        ...forwardArgs(),
      ]);
    }
    return stop('partial', 'Current capture complete. Stop for approval before implementation.');
  }

  if (!approved(state.approval)) {
    return stop('failed', 'Approval is rejected or needs revision. Do not implement yet.');
  }

  if (!state.implementation) {
    return command('implementation', 'Mark implementation as started.', [
      'scripts/activity/implementation-marker.mjs',
      ...forwardArgs(),
      '--status',
      'started',
    ]);
  }

  if (state.implementation.implementationStatus === 'blocked') {
    return stop('failed', 'Implementation is blocked. Resolve blocker before validation.');
  }

  if (state.implementation.implementationStatus !== 'completed') {
    return stop('partial', 'Implementation has started. Mark completed before Stage 8 validation.');
  }

  if (!acceptable(state.stage8)) {
    if (state.stage8?.result === 'failed') {
      return stop('failed', 'Stage 8 validation failed. Fix validation output first.');
    }
    return command('stage-8-validation', 'Run implementation validation capture.', [
      'scripts/activity/stage8-validate.mjs',
      ...forwardArgs(),
      ...approvedSourceArgs(state.approval),
    ]);
  }

  if (!state.validationVerdict) {
    if (args.verdict) {
      return command('validation-verdict', 'Record validation verdict.', [
        'scripts/activity/validation-verdict.mjs',
        ...forwardArgs(),
      ]);
    }
    return stop('partial', 'Stage 8 complete. Stop for validation verdict.');
  }

  return command('notion-sync', 'Sync latest activity state to Notion or dry-run report.', [
    'scripts/activity/notion-sync.mjs',
    ...forwardArgs(),
    ...(args.write ? ['--write'] : []),
  ]);
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

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion request failed: ${method} ${path} ${res.status} ${text}`);
  }

  return res.json();
}

function selectName(property) {
  return property?.select?.name ?? null;
}

function richTextValue(property) {
  return property?.rich_text?.map((part) => part.plain_text).join('') ?? '';
}

function normalizeNotionId(value) {
  return String(value).replace(/-/g, '').trim();
}

function runDecision(decision) {
  if (dryRun) return null;
  const started = Date.now();
  const child = spawnSync('node', decision.command, {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    stdio: 'pipe',
    maxBuffer: 20 * 1024 * 1024,
  });

  const stdoutPath = resolve(artifactDir, `${decision.nextStage}-stdout.log`);
  const stderrPath = resolve(artifactDir, `${decision.nextStage}-stderr.log`);
  writeFileSync(stdoutPath, redactSecrets(child.stdout));
  writeFileSync(stderrPath, redactSecrets(child.stderr));

  return {
    command: `node ${decision.command.join(' ')}`,
    exitCode: child.status,
    stdoutPath,
    stderrPath,
    stdoutPreview: preview(child.stdout),
    stderrPreview: preview(child.stderr),
    childReport: extractJsonSummary(child.stdout),
    durationMs: Date.now() - started,
  };
}

function command(stage, reason, commandArgs) {
  return {
    result: 'passed',
    nextStage: stage,
    action: dryRun ? 'would-run' : 'run',
    reason,
    command: commandArgs,
  };
}

function stop(result, reason) {
  return {
    result,
    action: 'stop',
    reason,
    command: null,
  };
}

function forwardArgs() {
  const omitted = new Set(['dryRun', 'write']);
  const output = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      output.push(arg);
      continue;
    }

    const equalsIndex = arg.indexOf('=');
    const rawKey = equalsIndex === -1 ? arg.slice(2) : arg.slice(2, equalsIndex);
    const inlineValue = equalsIndex === -1 ? undefined : arg.slice(equalsIndex + 1);
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (!omitted.has(key)) {
      output.push(arg);
      continue;
    }

    if (inlineValue === undefined && argv[index + 1] && !argv[index + 1].startsWith('--')) {
      index += 1;
    }
  }

  return output;
}

function approvedSourceArgs(approval) {
  const values = [];
  if (approval.approvedLocal) values.push('--approved-local', approval.approvedLocal);
  if (approval.figmaUrl) values.push('--approved-figma', approval.figmaUrl);
  if (approval.notionUrl) values.push('--approved-notion', approval.notionUrl);
  return values;
}

function acceptable(report) {
  return report?.result === 'passed' || report?.result === 'partial';
}

function passed(report) {
  return report?.result === 'passed';
}

function approved(report) {
  return report?.approvalStatus === 'approved' || report?.approvalStatus === 'not-needed';
}

function preview(value) {
  const text = redactSecrets(value).trim();
  if (!text) return '';
  return text.length > 1_000
    ? `${text.slice(0, 500)}\n...[truncated]...\n${text.slice(-500)}`
    : text;
}

function redactSecrets(value) {
  return String(value ?? '')
    .replace(/(orsk-)[A-Za-z0-9._-]+/g, '$1[REDACTED]')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[REDACTED]')
    .replace(/((?:TOKEN|KEY|SECRET|PASSWORD)[A-Z0-9_]*\s*=\s*)[^\s]+/gi, '$1[REDACTED]');
}

function extractJsonSummary(value) {
  const text = String(value ?? '').trim();
  const start = text.lastIndexOf('\n{');
  const jsonText = start >= 0 ? text.slice(start + 1) : text.startsWith('{') ? text : null;
  if (!jsonText) return null;

  try {
    const parsed = JSON.parse(jsonText);
    return {
      stage: parsed.stage,
      result: parsed.result,
      nextAction: parsed.nextAction,
      artifactDir: parsed.artifactDir,
      durationMs: parsed.durationMs,
    };
  } catch {
    return null;
  }
}

function printHelp() {
  console.log(`Activity runner

Usage:
  pnpm activity:run --activity <id> --attempt <id> [options]

Behavior:
  Reads local activity artifacts, executes exactly one valid next stage, and stops at approval gates.

Options:
  --dry-run true             Show the next action without executing it
  --intent <text>            Create capture plan when missing
  --approval <status>        Record approval when capture is waiting
  --verdict <status>         Record validation verdict when validation is waiting
  --write                    Pass through to Notion sync when it is the next stage
`);
}
