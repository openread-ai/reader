#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { ensureDir, getActivityConfig, parseArgs, readJsonIfExists, writeJson } from './common.mjs';

const argv = process.argv.slice(2);
const args = parseArgs(argv);
if (args.help || args.h) {
  printHelp();
  process.exit(0);
}

const config = getActivityConfig(argv);
const startedAtMs = Date.now();
const startedAt = new Date(startedAtMs).toISOString();
const artifactDir = resolve(config.attemptDir, 'stage-3-platform-test');

ensureDir(artifactDir);

const lanes = [];
lanes.push(
  runLane('platform-readiness', 'all-requested-platforms', 'node', [
    'scripts/activity/stage3-readiness.mjs',
    ...argv,
  ]),
);

if (shouldRunAndroidSmoke()) {
  lanes.push(
    runLane('platform-smoke', 'android', 'node', [
      'scripts/activity/android-platform-smoke.mjs',
      ...argv,
    ]),
  );
} else if (config.platforms.includes('android')) {
  lanes.push({
    lane: 'platform-smoke',
    platform: 'android',
    result: 'skipped',
    reason: 'Pass --android-smoke true to run build/install/launch/screenshot checks.',
  });
}

const failed = lanes.filter((lane) => lane.result === 'failed');
const partial = lanes.filter((lane) => lane.result === 'partial');
const result = failed.length > 0 ? 'failed' : partial.length > 0 ? 'partial' : 'passed';
const report = {
  schemaVersion: 1,
  stage: 'stage-3-platform-test',
  result,
  activityId: config.activityId,
  activityUuid: config.activityUuid,
  attemptId: config.attemptId,
  platforms: config.platforms,
  artifactDir,
  execution: 'sequential',
  lanes,
  nextAction:
    result === 'passed'
      ? 'Run Stage 4 current-state capture using the browser or native lane requested by the capture plan.'
      : result === 'partial'
        ? 'Review platform-test warnings, then run Stage 4 if the warnings are acceptable.'
        : 'Fix failed platform-test lanes and retry with a new attempt.',
  startedAt,
  finishedAt: new Date().toISOString(),
  durationMs: Date.now() - startedAtMs,
  createdAt: startedAt,
};

writeJson(resolve(artifactDir, 'platform-test-report.json'), report);
console.log(JSON.stringify(report, null, 2));
process.exit(result === 'failed' ? 1 : 0);

function shouldRunAndroidSmoke() {
  return config.platforms.includes('android') && String(args.androidSmoke ?? 'false') === 'true';
}

function runLane(lane, platform, executable, commandArgs) {
  const started = Date.now();
  const result = spawnSync(executable, commandArgs, {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: lane === 'platform-smoke' ? 1_200_000 : 180_000,
    maxBuffer: 20 * 1024 * 1024,
  });

  const childReport = readLaneReport(lane);

  return {
    lane,
    platform,
    result: childReport?.result ?? (result.status === 0 ? 'passed' : 'failed'),
    command: `${executable} ${commandArgs.join(' ')}`,
    exitCode: result.status,
    reportPath: childReport?.path ?? null,
    stdout: trim(result.stdout),
    stderr: trim(result.stderr),
    durationMs: Date.now() - started,
  };
}

function readLaneReport(lane) {
  const path =
    lane === 'platform-readiness'
      ? resolve(config.stage3Dir, 'readiness-report.json')
      : lane === 'platform-smoke'
        ? resolve(config.attemptDir, 'android-platform-smoke/android-smoke-report.json')
        : null;
  if (!path) return null;
  const report = readJsonIfExists(path);
  return report ? { path, result: report.result } : null;
}

function trim(value) {
  const text = String(value ?? '').trim();
  return text.length > 4_000 ? `${text.slice(0, 4_000)}...[truncated]` : text;
}

function printHelp() {
  console.log(`Stage 3 platform test

Usage:
  pnpm activity:stage3-test --activity <id> --attempt <id> --platforms <list> [options]

Behavior:
  Runs Stage 3 readiness for all requested platforms.
  Runs optional platform-specific smoke lanes when explicitly requested.
  Execution is sequential by default to avoid device/emulator races.

Options:
  --native-targets <list>      Validate native target toolchains/devices in readiness
  --android-smoke true         Also run Android build/install/launch/screenshot smoke
  --android-serial <serial>    adb serial for Android smoke
  --build false                Passed to Android smoke when enabled
  --install false              Passed to Android smoke when enabled
  --launch false               Passed to Android smoke when enabled
`);
}
