#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureDir, getActivityConfig, parseArgs, resolveProjects, writeJson } from './common.mjs';
import { resolveNativeTargets } from './native-fixtures.mjs';

const config = getActivityConfig(process.argv.slice(2));
const args = parseArgs(process.argv.slice(2));
if (args.help || args.h) {
  printHelp();
  process.exit(0);
}

const startedAtMs = Date.now();
const startedAt = new Date(startedAtMs).toISOString();
const appRoot = process.cwd();
const packageRunner = process.env.OPENREAD_PACKAGE_RUNNER ?? 'corepack';
const packageRunnerPrefix = packageRunner === 'corepack' ? ['pnpm'] : [];
const artifactDir = resolve(config.attemptDir, 'platform-health');
const projects = resolveProjects(config.platforms).filter(({ project }) =>
  ['chromium', 'webkit', 'mobile-webkit', 'mobile-chromium', 'msedge'].includes(project),
);
const nativeTargets = resolveNativeTargets(args.nativeTargets, config.platforms);
const requireNativeAuth =
  args.requireNativeAuth === true ||
  args.requireNativeAuth === 'true' ||
  process.env.OPENREAD_REQUIRE_NATIVE_AUTH_HEALTH === 'true';
const runNativeLaunch =
  args.nativeLaunch !== 'false' && process.env.OPENREAD_NATIVE_LAUNCH_HEALTH !== 'false';
const healthOpenUrl =
  args.openUrl ??
  'openread://activity-capture?route=%2Fauth&screen=auth&state=platform-health&auth=anonymous&onboarding=skip';

ensureDir(artifactDir);

const playwrightArgs = ['exec', 'playwright', 'test', 'e2e/tests/activity/platform-health.spec.ts'];
for (const { project } of projects) playwrightArgs.push(`--project=${project}`);

const playwright = spawnSync(packageRunner, [...packageRunnerPrefix, ...playwrightArgs], {
  cwd: appRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    OPENREAD_ACTIVITY_ID: config.activityId,
    OPENREAD_ACTIVITY_ATTEMPT: config.attemptId,
    OPENREAD_ACTIVITY_ARTIFACT_DIR: artifactDir,
  },
});

const nativeHealth = nativeTargets.map((target) => {
  const platform = target.startsWith('android') ? 'android' : 'ios';
  const authReady = process.env.OPENREAD_NATIVE_AUTH_SESSION_READY === 'true';
  const logoutReady = process.env.OPENREAD_NATIVE_LOGOUT_READY === 'true';
  const launch = runNativeLaunch ? runNativeLaunchHealth(target, platform) : null;
  const launchEvidence =
    launch?.evidence ?? latestNativeLaunchEvidence(config.activityDir, platform);
  const nativeLoginReady = authReady && logoutReady;
  const hasLaunchEvidence = Boolean(launchEvidence);
  const status = !hasLaunchEvidence
    ? 'blocked'
    : requireNativeAuth && !nativeLoginReady
      ? 'blocked'
      : 'passed';
  return {
    target,
    platform,
    status,
    openreadRunningEvidence: launchEvidence,
    launch,
    loginLogout: nativeLoginReady
      ? 'ready'
      : requireNativeAuth
        ? 'blocked: native login/logout requires OPENREAD_NATIVE_AUTH_SESSION_READY=true and OPENREAD_NATIVE_LOGOUT_READY=true or a secure native auth fixture adapter'
        : 'guarded: native login/logout requires a secure native auth fixture/session and was not required for this app-running health check',
  };
});

const nativeBlocked = nativeHealth.some((entry) => entry.status === 'blocked');
const result = playwright.status === 0 && !nativeBlocked ? 'passed' : 'failed';
const report = {
  schemaVersion: 1,
  stage: 'platform-health',
  result,
  activityId: config.activityId,
  activityUuid: config.activityUuid,
  attemptId: config.attemptId,
  platforms: config.platforms,
  projects,
  nativeTargets,
  requireNativeAuth,
  runNativeLaunch,
  healthOpenUrl,
  playwright: {
    status: playwright.status === 0 ? 'passed' : 'failed',
    command: `${packageRunner} ${[...packageRunnerPrefix, ...playwrightArgs].join(' ')}`,
    exitCode: playwright.status,
  },
  nativeHealth,
  nextAction:
    result === 'passed'
      ? 'Record platform-health-report.json as Stage 2 evidence.'
      : 'Fix failed platform health checks before proceeding past readiness.',
  startedAt,
  finishedAt: new Date().toISOString(),
  durationMs: Date.now() - startedAtMs,
  createdAt: startedAt,
};

writeJson(resolve(artifactDir, 'platform-health-report.json'), report);
console.log(JSON.stringify(report, null, 2));
process.exit(result === 'passed' ? 0 : 1);

function runNativeLaunchHealth(target, platform) {
  const attempt = `${config.attemptId}-${platform}-running`;
  const platformArg = platform === 'android' ? 'android' : 'ios';
  const commandArgs =
    platform === 'android'
      ? [
          'activity:android-smoke',
          '--',
          '--activity',
          config.activityId,
          '--attempt',
          attempt,
          '--platforms',
          platformArg,
          '--build',
          'false',
          '--install',
          'false',
          '--open-url',
          healthOpenUrl,
          '--lock-wait-ms',
          '300000',
        ]
      : [
          'activity:stage4-native',
          '--',
          '--activity',
          config.activityId,
          '--attempt',
          attempt,
          '--platforms',
          platformArg,
          '--native-targets',
          target,
          '--open-url',
          healthOpenUrl,
          '--lock-wait-ms',
          '300000',
        ];

  const result = spawnSync(packageRunner, [...packageRunnerPrefix, ...commandArgs], {
    cwd: appRoot,
    stdio: 'inherit',
    env: process.env,
  });
  return {
    status: result.status === 0 ? 'passed' : 'failed',
    command: `${packageRunner} ${[...packageRunnerPrefix, ...commandArgs].join(' ')}`,
    exitCode: result.status,
    evidence: latestNativeLaunchEvidence(config.activityDir, platform, attempt),
  };
}

function latestNativeLaunchEvidence(activityDir, platform, attempt = null) {
  const files = collectJsonFiles(activityDir)
    .filter((file) => (attempt ? file.includes(`/${attempt}/`) : true))
    .filter((file) =>
      platform === 'android'
        ? file.includes('/android-platform-smoke/') ||
          file.includes('/stage-4-current-capture/native/')
        : file.includes('/stage-4-current-capture/native/'),
    )
    .filter((file) => {
      const text = safeRead(file);
      if (!text) return false;
      if (platform === 'android') {
        return (
          text.includes('Android smoke screenshot captured') ||
          text.includes('Android app opens activity deep link') ||
          text.includes('android-device')
        );
      }
      return text.includes('captured') || text.includes('ios-simulator') || text.includes('iPhone');
    });
  const preferred = files.filter(
    (file) =>
      file.endsWith('android-smoke-report.json') ||
      file.endsWith('native-capture-run.json') ||
      file.endsWith('ios-simulator.json') ||
      file.endsWith('android-device.json'),
  );
  return (preferred.length > 0 ? preferred : files).sort().at(-1) ?? null;
}

function collectJsonFiles(root) {
  if (!existsSync(root)) return [];
  const stack = [root];
  const files = [];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) stack.push(path);
      else if (entry.isFile() && path.endsWith('.json')) files.push(path);
    }
  }
  return files;
}

function safeRead(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function printHelp() {
  console.log(`Platform health smoke

Usage:
  pnpm activity:platform-health --activity <id> --attempt <id> --platforms web,ios,android [options]

Behavior:
  Runs a Playwright Openread load/login/logout health smoke for selected web-layer projects and records native readiness evidence.

Options:
  --native-targets <targets>       Native targets to evaluate, e.g. ios-simulator,android-device
  --require-native-auth true       Fail unless native login/logout readiness is explicitly declared
`);
}
