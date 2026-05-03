#!/usr/bin/env node
import { resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import {
  ensureDir,
  getActivityConfig,
  parseArgs,
  readCapturePlan,
  resolveProjects,
  writeJson,
} from './common.mjs';

const rawArgs = process.argv.slice(2);
const args = parseArgs(rawArgs);
if (args.help || args.h) {
  printHelp();
  process.exit(0);
}

const config = getActivityConfig(process.argv.slice(2));
const startedAtMs = Date.now();
const startedAt = new Date(startedAtMs).toISOString();
const appRoot = process.cwd();
const projects = resolveProjects(config.platforms);
const capturePlan = readCapturePlan(config);
const route = capturePlan?.target?.route ?? config.route;
const selector = capturePlan?.target?.selector ?? config.selector;
const fixtureMode = capturePlan?.fixtures?.auth === 'authenticated' ? 'authenticated' : 'anonymous';

ensureDir(config.stage4Dir);

const runSummary = {
  schemaVersion: 1,
  stage: 'stage-4-browser-capture',
  result: 'running',
  activityId: config.activityId,
  activityUuid: config.activityUuid,
  attemptId: config.attemptId,
  route,
  selector,
  capturePlanPath: config.capturePlanPath,
  capturePlan,
  platforms: config.platforms,
  projects,
  artifactDir: config.stage4Dir,
  startedAt,
};
writeJson(resolve(config.stage4Dir, 'capture-run.json'), runSummary);

await ensureDevServerHealthyOrFree();

const playwrightArgs = ['exec', 'playwright', 'test', 'e2e/tests/activity/current-capture.spec.ts'];
for (const { project } of projects) {
  playwrightArgs.push(`--project=${project}`);
}

const result = spawnSync('pnpm', playwrightArgs, {
  cwd: appRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    OPENREAD_ACTIVITY_ID: config.activityId,
    OPENREAD_ACTIVITY_ATTEMPT: config.attemptId,
    OPENREAD_ACTIVITY_ROUTE: route,
    OPENREAD_ACTIVITY_SELECTOR: selector,
    OPENREAD_ACTIVITY_FIXTURE_MODE: fixtureMode,
    OPENREAD_ACTIVITY_SCREEN: capturePlan?.target?.screen ?? '',
    OPENREAD_ACTIVITY_ARTIFACT_DIR: config.stage4Dir,
  },
});

const completedSummary = {
  ...runSummary,
  result: result.status === 0 ? 'passed' : 'failed',
  exitCode: result.status,
  finishedAt: new Date().toISOString(),
  durationMs: Date.now() - startedAtMs,
  nextAction:
    result.status === 0
      ? 'Attach capture-manifest.json and screenshots to the activity record.'
      : 'Inspect Playwright output and retry Stage 4 with a new attempt.',
};
writeJson(resolve(config.stage4Dir, 'capture-run.json'), completedSummary);

const captures = projects.map(({ platform, project }) => {
  const metadataPath = resolve(config.stage4Dir, `${project}.json`);
  if (!existsSync(metadataPath)) {
    return {
      platform,
      project,
      result: 'missing',
    };
  }

  return {
    platform,
    project,
    result: 'captured',
    ...JSON.parse(readFileSync(metadataPath, 'utf8')),
  };
});

writeJson(resolve(config.stage4Dir, 'capture-manifest.json'), {
  schemaVersion: 1,
  stage: 'stage-4-browser-capture',
  result: completedSummary.result,
  activityId: config.activityId,
  activityUuid: config.activityUuid,
  attemptId: config.attemptId,
  route,
  selector,
  fixtureMode,
  capturePlanPath: config.capturePlanPath,
  artifactDir: config.stage4Dir,
  startedAt,
  finishedAt: completedSummary.finishedAt,
  durationMs: completedSummary.durationMs,
  captures,
  createdAt: new Date().toISOString(),
});

process.exit(result.status ?? 1);

async function ensureDevServerHealthyOrFree() {
  const url = 'http://localhost:3000/';
  const healthy = await canFetch(url, 3_000);
  if (healthy) return;

  const pids = listeningPids(3000);
  if (pids.length === 0) return;

  console.error(
    `[activity-stage4] Existing dev server on port 3000 did not respond; terminating ${pids.join(', ')} so Playwright can start a fresh server.`,
  );
  for (const pid of pids) killPid(pid, 'SIGTERM');
  await new Promise((resolveWait) => setTimeout(resolveWait, 2_000));

  const remaining = listeningPids(3000);
  if (remaining.length > 0) {
    console.error(
      `[activity-stage4] Dev server still owns port 3000 after SIGTERM; force terminating ${remaining.join(', ')}.`,
    );
    for (const pid of remaining) killPid(pid, 'SIGKILL');
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
  }
}

function killPid(pid, signal) {
  try {
    process.kill(Number(pid), signal);
  } catch {
    // Ignore stale pids.
  }
}

async function canFetch(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function listeningPids(port) {
  try {
    return execFileSync('lsof', ['-ti', `tcp:${port}`], { encoding: 'utf8' })
      .split('\n')
      .map((pid) => pid.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function printHelp() {
  console.log(`Stage 4 browser current capture

Usage:
  pnpm activity:stage4-browser --activity <id> --attempt <id> --platforms <list> [options]

Behavior:
  Runs Playwright current-state capture for the requested browser/mobile-web projects.

Options:
  --route <path>       Route to capture when no capture plan exists
  --selector <css>     Selector to screenshot when no capture plan exists
`);
}
