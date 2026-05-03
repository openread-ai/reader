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
const capturePlan = readJsonIfExists(config.capturePlanPath);
const effectivePlatforms = capturePlan?.platforms ?? config.platforms;
const startedAtMs = Date.now();
const startedAt = new Date(startedAtMs).toISOString();
const artifactDir = config.stage4Dir;
const lanes = resolveLanes();

ensureDir(artifactDir);

const captures = lanes.map((lane) => {
  if (lane === 'browser') {
    return runLane('browser', 'node', [
      'scripts/activity/stage4-browser-capture.mjs',
      ...argv,
      '--platforms',
      effectivePlatforms.join(','),
    ]);
  }
  return runLane('native', 'node', ['scripts/activity/stage4-native-capture.mjs', ...argv]);
});

const failed = captures.filter((capture) => capture.result === 'failed');
const partial = captures.filter((capture) => capture.result === 'partial');
const result = failed.length > 0 ? 'failed' : partial.length > 0 ? 'partial' : 'passed';
const report = {
  schemaVersion: 1,
  stage: 'stage-4-current-capture',
  result,
  activityId: config.activityId,
  activityUuid: config.activityUuid,
  attemptId: config.attemptId,
  platforms: effectivePlatforms,
  captureLane: args.captureLane ?? 'auto',
  lanes,
  artifactDir,
  captures,
  nextAction:
    result === 'passed'
      ? 'Sync artifacts and stop for design approval before implementation.'
      : result === 'partial'
        ? 'Review partial capture lanes and decide whether to proceed to design approval.'
        : 'Fix failed capture lanes and retry with a new attempt.',
  startedAt,
  finishedAt: new Date().toISOString(),
  durationMs: Date.now() - startedAtMs,
  createdAt: startedAt,
};

writeJson(resolve(artifactDir, 'current-capture-report.json'), report);
console.log(JSON.stringify(report, null, 2));
process.exit(result === 'failed' ? 1 : 0);

function resolveLanes() {
  const lane = String(args.captureLane ?? 'auto');
  if (lane === 'browser') return ['browser'];
  if (lane === 'native') return ['native'];
  if (lane === 'all') return ['browser', 'native'];
  if (args.nativeTargets || process.env.OPENREAD_NATIVE_TARGETS) return ['native'];
  return ['browser'];
}

function runLane(lane, executable, commandArgs) {
  const started = Date.now();
  const result = spawnSync(executable, commandArgs, {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: lane === 'native' ? 1_200_000 : 300_000,
    maxBuffer: 20 * 1024 * 1024,
  });
  const report = readLaneReport(lane);

  return {
    lane,
    result: report?.result ?? (result.status === 0 ? 'passed' : 'failed'),
    command: `${executable} ${commandArgs.join(' ')}`,
    exitCode: result.status,
    reportPath: report?.path ?? null,
    stdout: trim(result.stdout),
    stderr: trim(result.stderr),
    durationMs: Date.now() - started,
  };
}

function readLaneReport(lane) {
  const path =
    lane === 'browser'
      ? resolve(config.stage4Dir, 'capture-manifest.json')
      : resolve(config.stage4Dir, 'native/native-capture-manifest.json');
  const report = readJsonIfExists(path);
  return report ? { path, result: report.result } : null;
}

function trim(value) {
  const text = String(value ?? '').trim();
  return text.length > 4_000 ? `${text.slice(0, 4_000)}...[truncated]` : text;
}

function printHelp() {
  console.log(`Stage 4 current capture

Usage:
  pnpm activity:stage4 --activity <id> --attempt <id> --platforms <list> [options]

Behavior:
  Runs the requested current-capture lane sequentially.
  Browser lane uses Playwright projects.
  Native lane uses simulator/device screenshot tooling and platform locks.

Options:
  --capture-lane auto|browser|native|all
  --native-targets <list>      Native targets for the native lane
  --lock-wait-ms <ms>          Wait for native platform locks
`);
}
