import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

export const platformProjects = {
  web: 'chromium',
  macos: 'webkit',
  windows: 'msedge',
  ios: 'mobile-webkit',
  android: 'mobile-chromium',
};

export function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;

    const equalsIndex = arg.indexOf('=');
    const rawKey = equalsIndex === -1 ? arg.slice(2) : arg.slice(2, equalsIndex);
    const inlineValue = equalsIndex === -1 ? undefined : arg.slice(equalsIndex + 1);
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const next = argv[index + 1];

    if (inlineValue !== undefined) {
      parsed[key] = inlineValue;
    } else if (next && !next.startsWith('--')) {
      parsed[key] = next;
      index += 1;
    } else {
      parsed[key] = true;
    }
  }

  return parsed;
}

export function getActivityConfig(argv) {
  const args = parseArgs(argv);
  const requestedActivity = sanitizeName(
    args.activity ?? process.env.OPENREAD_ACTIVITY_ID ?? 'sandbox-activity',
  );
  const attemptId = sanitizeName(
    args.attempt ?? process.env.OPENREAD_ACTIVITY_ATTEMPT ?? timestampAttempt(),
  );
  const route = args.route ?? process.env.OPENREAD_ACTIVITY_ROUTE ?? '/';
  const selector = args.selector ?? process.env.OPENREAD_ACTIVITY_SELECTOR ?? 'body';
  const platformInput = args.platforms ?? process.env.OPENREAD_ACTIVITY_PLATFORMS ?? 'web';
  const platforms = platformInput
    .split(',')
    .map((platform) => platform.trim().toLowerCase())
    .filter(Boolean);
  const artifactRoot = resolve(
    args.artifactRoot ??
      process.env.OPENREAD_ACTIVITY_ARTIFACT_ROOT ??
      resolve(homedir(), '.openread-dev/activity-artifacts'),
  );
  const activityId = resolveActivityId(artifactRoot, requestedActivity);
  const attemptDir = resolve(artifactRoot, activityId, attemptId);
  const activityDir = resolve(artifactRoot, activityId);
  const metadata = readJsonIfExists(resolve(activityDir, 'activity.json'));
  const activityUuid =
    args.activityUuid ?? process.env.OPENREAD_ACTIVITY_UUID ?? metadata?.activityUuid ?? null;

  return {
    activityId,
    activityUuid,
    attemptId,
    route,
    selector,
    platforms,
    artifactRoot,
    activityDir,
    attemptDir,
    capturePlanPath: resolve(activityDir, 'capture-plan.json'),
    stage3Dir: resolve(attemptDir, 'stage-3-readiness'),
    stage4Dir: resolve(attemptDir, 'stage-4-current-capture'),
    stage8Dir: resolve(attemptDir, 'stage-8-validation'),
  };
}

export function readCapturePlan(config) {
  return readJsonIfExists(config.capturePlanPath);
}

export function buildActivityCaptureUrl(plan) {
  const route = plan?.target?.route;
  if (!route) return null;

  const url = new URL('openread://activity-capture');
  url.searchParams.set('route', route);
  if (plan.target.screen) url.searchParams.set('screen', plan.target.screen);
  if (plan.target.state) url.searchParams.set('state', plan.target.state);
  if (plan.fixtures?.book?.mode === 'any-library-book') {
    url.searchParams.set('book', 'first-library-book');
  }
  return url.toString();
}

export function loadActivityEnv() {
  const candidates = [
    resolve(homedir(), '.openread-dev/.env'),
    resolve(process.cwd(), '.env.local'),
    resolve(process.cwd(), '../../.env.local'),
  ];

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const index = trimmed.indexOf('=');
      const key = trimmed.slice(0, index).trim();
      const value = trimmed
        .slice(index + 1)
        .trim()
        .replace(/^['"]|['"]$/g, '');
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  }
}

function resolveActivityId(artifactRoot, requestedActivity) {
  const exactMetadataPath = resolve(artifactRoot, requestedActivity, 'activity.json');
  if (existsSync(exactMetadataPath)) return requestedActivity;

  const registry = readJsonIfExists(resolve(artifactRoot, 'activity-registry.json'));
  const activities = registry?.activities ?? [];
  const exactMatch = activities.find((activity) => activity.activityId === requestedActivity);
  if (exactMatch) return exactMatch.activityId;

  const slugMatches = activities.filter((activity) => activity.slug === requestedActivity);
  if (slugMatches.length > 0) {
    return slugMatches.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0]
      .activityId;
  }

  return requestedActivity;
}

export function resolveProjects(platforms) {
  return platforms.map((platform) => ({
    platform,
    project: platformProjects[platform] ?? platform,
    recognizedPlatform: Boolean(platformProjects[platform]),
  }));
}

export function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

export function writeJson(path, data) {
  ensureDir(resolve(path, '..'));
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

export function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function fileCheck(path, label, severity = 'error') {
  return {
    label,
    severity,
    path,
    ok: existsSync(path),
  };
}

export function resolveAndroidSdkRoot() {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    '/opt/homebrew/share/android-commandlinetools',
    resolve(homedir(), 'Library/Android/sdk'),
    resolve(homedir(), 'Android/Sdk'),
  ].filter(Boolean);

  return candidates.find((path) => existsSync(path)) ?? null;
}

export function androidTool(name) {
  const sdkRoot = resolveAndroidSdkRoot();
  if (!sdkRoot) return name;

  const locations = [
    resolve(sdkRoot, 'platform-tools', name),
    resolve(sdkRoot, 'emulator', name),
    resolve(sdkRoot, 'cmdline-tools/latest/bin', name),
  ];

  return locations.find((path) => existsSync(path)) ?? name;
}

export function acquirePlatformLock({ platform, owner, waitMs = 0, staleMs = 30 * 60_000 }) {
  const lockRoot = resolve(homedir(), '.openread-dev/activity-locks');
  const lockDir = resolve(lockRoot, `${sanitizeName(platform)}.lock`);
  const startedAt = Date.now();

  mkdirSync(lockRoot, { recursive: true });

  while (true) {
    try {
      mkdirSync(lockDir);
      const lock = {
        platform,
        owner,
        pid: process.pid,
        hostname: process.env.HOSTNAME ?? null,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + staleMs).toISOString(),
      };
      writeJson(resolve(lockDir, 'lock.json'), lock);
      return { path: lockDir, lock };
    } catch (error) {
      const existing = readJsonIfExists(resolve(lockDir, 'lock.json'));
      const expiresAt = existing?.expiresAt ? Date.parse(existing.expiresAt) : null;
      if (expiresAt && expiresAt < Date.now()) {
        rmSync(lockDir, { recursive: true, force: true });
        continue;
      }

      if (Date.now() - startedAt >= waitMs) {
        const detail = existing
          ? `held by ${existing.owner ?? 'unknown'} until ${existing.expiresAt ?? 'unknown'}`
          : 'held by another process';
        throw new Error(`Platform lock ${platform} is busy: ${detail}`);
      }

      sleep(1_000);
    }
  }
}

export function releasePlatformLock(handle) {
  if (!handle?.path) return;
  rmSync(handle.path, { recursive: true, force: true });
}

function sanitizeName(value) {
  return String(value)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function timestampAttempt() {
  return `attempt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
