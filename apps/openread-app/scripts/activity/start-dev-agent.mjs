#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { formatActivityTimestamp, parseArgs } from './common.mjs';

const args = parseArgs(process.argv.slice(2));
const explicitIntent = args.intent ? String(args.intent) : null;
const mode = ['continuous', 'resume'].includes(args.mode) ? args.mode : 'discrete';
const maxSteps = args.maxSteps ? clampNumber(args.maxSteps, 1, 20) : null;
const transitionLimit = mode === 'discrete' ? 1 : (maxSteps ?? 1);
const stepTimeoutMs = args.stepTimeoutMs
  ? clampNumber(args.stepTimeoutMs, 1_000, 2 * 60 * 60 * 1000)
  : Number(process.env.OPENREAD_START_DEV_STEP_TIMEOUT_MS ?? 30 * 60 * 1000);
const activityId = resolveActivityId(
  args.activity ?? process.env.OPENREAD_ACTIVITY_ID,
  explicitIntent,
);
const allowMutation = args.allowMutation === true;
const allowExpensive = args.allowExpensive === true;

if (!activityId)
  fail('Activity ID or --intent required. Pass --activity ACT-... or --intent "...".');

const steps = [];
const runAttemptId = attemptId('run', 0);
let result = 'passed';
let stopReason = 'max steps reached';

for (let index = 0; index < transitionLimit; index += 1) {
  liveLog(`pickup ${index + 1}/${transitionLimit}: reading Activity state for ${activityId}`);
  const pickup = runPnpmJson([
    'activity:notion-sync',
    '--activity',
    activityId,
    '--attempt',
    attemptId('pickup', index),
    '--write',
    '--no-event',
    '--summary',
    `start-dev-agent pickup ${index + 1}.`,
  ]);

  if (pickup.exitCode !== 0) {
    result = 'failed';
    stopReason = 'failed to read/write Activity Log pickup context';
    liveLog(`pickup failed: ${preview(pickup.stderrPreview || pickup.stdoutPreview)}`);
    steps.push(stepResult(index, 'pickup', pickup));
    break;
  }

  const context = pickup.json?.pickupContext ?? pickup.json;
  const intent = explicitIntent ?? deriveIntent(context);
  const gate = gateForContext(context);
  if (gate && mode !== 'resume') {
    stopReason = gate;
    liveLog(`stopping at gate: ${gate}`);
    break;
  }

  const stageMode = mode === 'resume' ? 'continuous' : mode;
  liveLog(`running next stage: mode=${stageMode}${intent ? ` intent="${preview(intent)}"` : ''}`);
  const run = runPnpmJson([
    'activity:run',
    '--activity',
    activityId,
    '--attempt',
    runAttemptId,
    '--mode',
    stageMode,
    ...(intent ? ['--intent', intent] : []),
    ...(args.testApproval ? ['--test-approval', args.testApproval] : []),
    ...(args.approval ? ['--approval', args.approval] : []),
    ...(allowMutation ? ['--allow-mutation'] : []),
    ...(mode === 'resume' ? ['--resume-failed-stage'] : []),
    '--write',
  ]);
  steps.push(
    stepResult(index, run.json?.decision?.nextStage ?? 'activity:run', run, {
      requestedMode: mode,
      executedMode: stageMode,
    }),
  );

  const stageName = run.json?.decision?.nextStage ?? 'activity:run';
  liveLog(
    `${stageName} ${run.exitCode === 0 && run.json?.result !== 'failed' ? 'passed' : 'failed'}`,
  );

  if (run.exitCode !== 0 || run.json?.result === 'failed') {
    result = 'failed';
    stopReason = `stage failed: ${run.json?.decision?.nextStage ?? 'unknown'}`;
    liveLog(`stopping: ${stopReason}`);
    break;
  }

  if (run.json?.result === 'partial') {
    stopReason = run.json?.decision?.reason ?? run.json?.nextAction ?? 'stage requested stop';
    liveLog(`stopping: ${stopReason}`);
    break;
  }

  stopReason =
    mode === 'discrete' ? 'discrete stage complete' : `completed ${index + 1} stage transition(s)`;
  if (mode === 'discrete') break;
}

liveLog(`finished: ${result}; ${stopReason}`);
console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      agent: 'start-dev-agent',
      result,
      activityId,
      mode,
      maxSteps,
      transitionLimit,
      stepTimeoutMs,
      stopReason,
      intent: explicitIntent ?? 'derived from Activity Log',
      steps,
      finishedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
process.exit(result === 'failed' ? 1 : 0);

function resolveActivityId(activityArg, intent) {
  if (activityArg) return String(activityArg);
  if (!intent) return null;

  const slug = slugify(intent);
  const existing = findRegisteredActivity(slug, intent);
  if (existing) return existing;

  const init = runPnpmJson(['activity:init', '--slug', slug, '--title', intent.slice(0, 120)]);
  if (init.exitCode !== 0 || !init.json?.activityId) {
    fail(`Unable to create Activity for intent: ${init.stderrPreview || init.stdoutPreview}`);
  }
  return init.json.activityId;
}

function findRegisteredActivity(slug, intent) {
  const registry = runNodeJson(
    "const fs=require('fs'),os=require('os'),p=require('path').join(os.homedir(),'.openread-dev/activity-artifacts/activity-registry.json'); if(fs.existsSync(p)) process.stdout.write(fs.readFileSync(p,'utf8'))",
  );
  const activities = Array.isArray(registry?.activities) ? registry.activities : [];
  const matches = activities.filter((activity) => {
    const haystack =
      `${activity.activityId ?? ''} ${activity.slug ?? ''} ${activity.title ?? ''}`.toLowerCase();
    return haystack.includes(slug) || haystack.includes(String(intent).toLowerCase());
  });
  if (matches.length === 0) return null;
  return matches.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0]
    .activityId;
}

function runNodeJson(script) {
  const child = spawnSync('node', ['-e', script], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  return child.status === 0 ? parseLastJson(child.stdout) : null;
}

function slugify(value) {
  return (
    String(value)
      .toLowerCase()
      .replace(/\bACT-\d{4}-\d{4}-[a-z0-9-]+\b/gi, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'start-dev-agent'
  );
}

function deriveIntent(context) {
  const title = String(context?.title ?? context?.notionTitle ?? '').trim();
  const summary = String(context?.agentSummary ?? '').trim();
  const nextAction = String(context?.nextAction ?? '').trim();
  const candidates = [summary, nextAction, title].filter(Boolean);
  return (
    candidates.find(
      (candidate) =>
        !candidate.startsWith('Review activity state') &&
        !candidate.startsWith('start-dev-agent progress check'),
    ) ?? null
  );
}

function gateForContext(context) {
  const status = String(context?.status ?? '');
  const stage = String(context?.currentStage ?? '');
  const approval = String(context?.approvalStatus ?? '');
  if (status === 'Blocked') return 'activity is blocked';
  if (approval && !['Not Needed', 'Approved'].includes(approval)) return `approval is ${approval}`;
  if (!allowMutation && stage === 'Implementation')
    return 'implementation requires --allow-mutation';
  if (!allowExpensive && ['Current Capture', 'Validation', 'Final Quality Gate'].includes(stage)) {
    return `${stage} requires --allow-expensive`;
  }
  return null;
}

function runPnpmJson(commandArgs) {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const child = spawnSync('pnpm', commandArgs, {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    stdio: 'pipe',
    maxBuffer: 20 * 1024 * 1024,
    timeout: stepTimeoutMs,
    killSignal: 'SIGTERM',
  });
  const finishedAt = new Date().toISOString();
  return {
    exitCode: child.status ?? (child.signal ? 124 : 1),
    command: `pnpm ${commandArgs.join(' ')}`,
    timedOut: child.error?.code === 'ETIMEDOUT' || Boolean(child.signal),
    signal: child.signal ?? null,
    json: parseLastJson(child.stdout),
    stdoutPreview: preview(child.stdout),
    stderrPreview: preview(child.stderr),
    startedAt,
    finishedAt,
    durationMs: Date.now() - started,
  };
}

function stepResult(index, stage, run, extra = {}) {
  return {
    index: index + 1,
    stage,
    ...extra,
    result: run.json?.result ?? (run.exitCode === 0 ? 'passed' : 'failed'),
    command: run.command,
    notionEventUrl: run.json?.activityEventPageUrl ?? run.json?.pickupContext?.activityEventPageUrl,
    nextAction: run.json?.nextAction ?? run.json?.pickupContext?.nextAction,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    durationMs: run.durationMs,
    timedOut: run.timedOut === true,
    signal: run.signal ?? null,
    stageTiming: {
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      durationMs: run.durationMs,
    },
  };
}

function attemptId(prefix, index) {
  return `start-dev-agent-${prefix}-${new Date()
    .toISOString()
    .replace(/[^0-9TZ]/g, '')
    .slice(0, 15)}-${index + 1}-${randomUUID().slice(0, 6)}`;
}

function parseLastJson(value) {
  const text = String(value ?? '').trim();
  const start = text.lastIndexOf('\n{');
  const jsonText = start >= 0 ? text.slice(start + 1) : text.startsWith('{') ? text : null;
  if (!jsonText) return null;
  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

function preview(value) {
  const text = String(value ?? '').trim();
  return text.length > 800 ? `${text.slice(0, 400)}\n...[truncated]...\n${text.slice(-400)}` : text;
}

function clampNumber(value, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : min;
}

function liveLog(message) {
  console.error(`[${formatActivityTimestamp()}] start-dev-agent: ${message}`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
