#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  androidTool,
  acquirePlatformLock,
  buildActivityCaptureUrl,
  ensureDir,
  getActivityConfig,
  parseArgs,
  readCapturePlan,
  releasePlatformLock,
  writeJson,
} from './common.mjs';
import { buildNativeFixtureManifest, writeNativeFixtureManifest } from './native-fixtures.mjs';

const config = getActivityConfig(process.argv.slice(2));
const startedAtMs = Date.now();
const startedAt = new Date(startedAtMs).toISOString();
const args = parseArgs(process.argv.slice(2));
const capturePlan = readCapturePlan(config);
const nativeTargets = resolveNativeTargets(args.nativeTargets, config.platforms);
const appBundleId =
  args.iosBundleId ?? process.env.OPENREAD_IOS_BUNDLE_ID ?? 'com.reglity.openread';
const androidPackage =
  args.androidPackage ?? process.env.OPENREAD_ANDROID_PACKAGE ?? 'com.reglity.openread';
const openUrl =
  args.openUrl ?? process.env.OPENREAD_NATIVE_OPEN_URL ?? buildActivityCaptureUrl(capturePlan);
const warmOnly =
  args.warmOnly === true ||
  args.warmOnly === 'true' ||
  process.env.OPENREAD_NATIVE_WARM_ONLY === 'true';
const delayMs = Number(args.delayMs ?? process.env.OPENREAD_NATIVE_CAPTURE_DELAY_MS ?? 2_000);
const lockWaitMs = Number(args.lockWaitMs ?? process.env.OPENREAD_ACTIVITY_LOCK_WAIT_MS ?? 0);
const artifactDir = resolve(config.stage4Dir, 'native');

ensureDir(artifactDir);
const nativeFixtureManifestPath = resolve(artifactDir, 'native-fixture-manifest.json');
const nativeFixtureManifest = writeNativeFixtureManifest(
  nativeFixtureManifestPath,
  buildNativeFixtureManifest({
    config,
    capturePlan,
    nativeTargets,
    openUrl,
    mode: 'capture',
  }),
);

const runSummary = {
  schemaVersion: 1,
  stage: 'stage-4-native-capture',
  result: 'running',
  activityId: config.activityId,
  activityUuid: config.activityUuid,
  attemptId: config.attemptId,
  capturePlanPath: config.capturePlanPath,
  capturePlan,
  nativeTargets,
  appBundleId,
  androidPackage,
  openUrl,
  warmOnly,
  nativeFixtureManifestPath,
  nativeFixtures: nativeFixtureManifest,
  delayMs,
  artifactDir,
  startedAt,
};

writeJson(resolve(artifactDir, 'native-capture-run.json'), runSummary);

const captures =
  nativeFixtureManifest.result === 'blocked'
    ? nativeTargets.map((target) => ({
        target,
        result: 'failed',
        error: 'Native fixture manifest is blocked; see native-fixture-manifest.json.',
        createdAt: new Date().toISOString(),
      }))
    : nativeTargets.map((target) => captureNativeTarget(target));
const failed = captures.filter((capture) => capture.result === 'failed');
const skipped = captures.filter((capture) => capture.result === 'skipped');
const result = failed.length > 0 ? 'failed' : skipped.length > 0 ? 'partial' : 'passed';

const completedSummary = {
  ...runSummary,
  result,
  captures,
  finishedAt: new Date().toISOString(),
  durationMs: Date.now() - startedAtMs,
  nextAction:
    result === 'passed'
      ? 'Attach native-capture-manifest.json and screenshots to the activity record.'
      : 'Inspect native capture errors and retry Stage 4 native capture with a new attempt.',
};

writeJson(resolve(artifactDir, 'native-capture-run.json'), completedSummary);
writeJson(resolve(artifactDir, 'native-capture-manifest.json'), {
  schemaVersion: 1,
  stage: 'stage-4-native-capture',
  result,
  activityId: config.activityId,
  activityUuid: config.activityUuid,
  attemptId: config.attemptId,
  capturePlanPath: config.capturePlanPath,
  artifactDir,
  startedAt,
  finishedAt: completedSummary.finishedAt,
  durationMs: completedSummary.durationMs,
  captures,
  createdAt: new Date().toISOString(),
});

console.log(JSON.stringify(completedSummary, null, 2));
process.exit(result === 'failed' ? 1 : 0);

function resolveNativeTargets(nativeTargetsArg, platforms) {
  const explicit = String(nativeTargetsArg ?? process.env.OPENREAD_NATIVE_TARGETS ?? '')
    .split(',')
    .map((target) => target.trim())
    .filter(Boolean);
  if (explicit.length > 0) return explicit;

  const targets = [];
  if (platforms.includes('ios')) targets.push('ios-simulator');
  if (platforms.includes('android')) targets.push('android-device');
  return targets;
}

function captureNativeTarget(target) {
  if (target === 'ios-simulator' || target.startsWith('ios-simulator:')) {
    return captureIosSimulator(targetValue(target));
  }
  if (target === 'ios-device') return captureIosDevice();
  if (target === 'android-emulator' || target === 'android-device') return captureAndroid(target);

  return {
    target,
    result: 'failed',
    error: `Unknown native target: ${target}`,
    createdAt: new Date().toISOString(),
  };
}

function captureIosSimulator(targetDevice) {
  const target = targetDevice ? `ios-simulator:${targetDevice}` : 'ios-simulator';
  const device =
    targetDevice ?? args.iosSimulator ?? process.env.OPENREAD_IOS_SIMULATOR ?? 'booted';
  const artifactName = targetDevice
    ? `ios-simulator-${sanitizeFileName(targetDevice)}`
    : 'ios-simulator';
  const screenshotPath = resolve(artifactDir, `${artifactName}.png`);
  const metadataPath = resolve(artifactDir, `${artifactName}.json`);
  const lock = acquireNativeLock(target);
  if (!lock.ok) return writeCaptureMetadata(metadataPath, lock.metadata(screenshotPath));

  const selectedDevice =
    device === 'booted' ? getBootedIosSimulator() : findOrBootIosSimulator(device);

  if (!selectedDevice.ok) {
    releasePlatformLock(lock.handle);
    return writeCaptureMetadata(metadataPath, {
      target,
      result: 'failed',
      screenshotPath,
      error: selectedDevice.error,
      createdAt: new Date().toISOString(),
    });
  }

  if (warmOnly) {
    releasePlatformLock(lock.handle);
    return writeCaptureMetadata(metadataPath, {
      target,
      result: 'warmed',
      screenshotPath,
      device: selectedDevice,
      createdAt: new Date().toISOString(),
    });
  }

  const launch = openUrl
    ? command('xcrun', ['simctl', 'openurl', selectedDevice.udid, openUrl])
    : command('xcrun', ['simctl', 'launch', selectedDevice.udid, appBundleId]);

  if (!launch.ok) {
    releasePlatformLock(lock.handle);
    return writeCaptureMetadata(metadataPath, {
      target,
      result: 'failed',
      screenshotPath,
      device: selectedDevice,
      error: launch.detail,
      createdAt: new Date().toISOString(),
    });
  }

  sleep(delayMs);

  const screenshot = command('xcrun', [
    'simctl',
    'io',
    selectedDevice.udid,
    'screenshot',
    screenshotPath,
  ]);
  const metadata = writeCaptureMetadata(metadataPath, {
    target,
    result: screenshot.ok && existsSync(screenshotPath) ? 'captured' : 'failed',
    screenshotPath,
    device: selectedDevice,
    launch: launch.detail,
    error: screenshot.ok ? null : screenshot.detail,
    createdAt: new Date().toISOString(),
  });
  releasePlatformLock(lock.handle);
  return metadata;
}

function captureIosDevice() {
  const target = 'ios-device';
  const screenshotPath = resolve(artifactDir, `${target}.png`);
  const metadataPath = resolve(artifactDir, `${target}.json`);
  const lock = acquireNativeLock(target);
  if (!lock.ok) return writeCaptureMetadata(metadataPath, lock.metadata(screenshotPath));

  const screenshotTool = command('idevicescreenshot', ['--help']);

  if (!screenshotTool.ok) {
    releasePlatformLock(lock.handle);
    return writeCaptureMetadata(metadataPath, {
      target,
      result: 'skipped',
      screenshotPath,
      error:
        'Real iPhone capture requires idevicescreenshot from libimobiledevice. Install it or use ios-simulator.',
      createdAt: new Date().toISOString(),
    });
  }

  if (warmOnly) {
    releasePlatformLock(lock.handle);
    return writeCaptureMetadata(metadataPath, {
      target,
      result: 'warmed',
      screenshotPath,
      createdAt: new Date().toISOString(),
    });
  }

  if (openUrl) {
    command('xcrun', ['devicectl', 'device', 'open', 'url', openUrl]);
  } else {
    command('ios-deploy', ['--bundle_id', appBundleId, '--justlaunch']);
  }

  sleep(delayMs);

  const screenshot = command('idevicescreenshot', [screenshotPath]);
  const metadata = writeCaptureMetadata(metadataPath, {
    target,
    result: screenshot.ok && existsSync(screenshotPath) ? 'captured' : 'failed',
    screenshotPath,
    error: screenshot.ok ? null : screenshot.detail,
    createdAt: new Date().toISOString(),
  });
  releasePlatformLock(lock.handle);
  return metadata;
}

function captureAndroid(target) {
  const serial = args.androidSerial ?? process.env.ANDROID_SERIAL ?? null;
  const adbArgs = serial ? ['-s', serial] : [];
  const adb = androidTool('adb');
  const screenshotPath = resolve(artifactDir, `${target}.png`);
  const metadataPath = resolve(artifactDir, `${target}.json`);
  const lock = acquireNativeLock(target);
  if (!lock.ok) return writeCaptureMetadata(metadataPath, lock.metadata(screenshotPath));

  const devices = command(adb, [...adbArgs, 'devices']);

  if (!devices.ok) {
    releasePlatformLock(lock.handle);
    return writeCaptureMetadata(metadataPath, {
      target,
      result: 'failed',
      screenshotPath,
      error: devices.detail,
      createdAt: new Date().toISOString(),
    });
  }

  if (warmOnly) {
    releasePlatformLock(lock.handle);
    return writeCaptureMetadata(metadataPath, {
      target,
      result: 'warmed',
      screenshotPath,
      serial,
      devices: devices.detail,
      createdAt: new Date().toISOString(),
    });
  }

  const launch = openUrl
    ? command(adb, [
        ...adbArgs,
        'shell',
        'am',
        'start',
        '-a',
        'android.intent.action.VIEW',
        '-d',
        openUrl,
      ])
    : command(adb, [...adbArgs, 'shell', 'monkey', '-p', androidPackage, '1']);

  if (!launch.ok) {
    releasePlatformLock(lock.handle);
    return writeCaptureMetadata(metadataPath, {
      target,
      result: 'failed',
      screenshotPath,
      error: launch.detail,
      createdAt: new Date().toISOString(),
    });
  }

  sleep(delayMs);

  const screenshot = spawnSync(adb, [...adbArgs, 'exec-out', 'screencap', '-p'], {
    encoding: 'buffer',
    maxBuffer: 25 * 1024 * 1024,
  });

  if (screenshot.status === 0 && screenshot.stdout.length > 0) {
    writeFileSync(screenshotPath, screenshot.stdout);
  }

  const metadata = writeCaptureMetadata(metadataPath, {
    target,
    result: screenshot.status === 0 && existsSync(screenshotPath) ? 'captured' : 'failed',
    screenshotPath,
    serial,
    launch: launch.detail,
    error: screenshot.status === 0 ? null : trim(screenshot.stderr || screenshot.stdout),
    createdAt: new Date().toISOString(),
  });
  releasePlatformLock(lock.handle);
  return metadata;
}

function acquireNativeLock(target) {
  const platform = target.startsWith('android') ? 'android' : 'ios';
  try {
    const handle = acquirePlatformLock({
      platform,
      owner: `${config.activityId}/${config.attemptId}/stage-4-native-capture/${target}`,
      waitMs: lockWaitMs,
    });
    return { ok: true, handle };
  } catch (error) {
    return {
      ok: false,
      metadata: (screenshotPath) => ({
        target,
        result: 'failed',
        screenshotPath,
        error: error.message,
        createdAt: new Date().toISOString(),
      }),
    };
  }
}

function getBootedIosSimulator() {
  const result = command('xcrun', ['simctl', 'list', 'devices', 'booted', '--json']);
  if (!result.ok) return { ok: false, error: result.detail };

  const devices = parseIosDevices(result.stdout).filter((device) => device.state === 'Booted');
  if (devices[0]) return { ok: true, ...devices[0] };

  return findOrBootIosSimulator(process.env.OPENREAD_IOS_SIMULATOR_FALLBACK ?? 'iPhone');
}

function findOrBootIosSimulator(nameOrUdid) {
  const list = command('xcrun', ['simctl', 'list', 'devices', 'available', '--json']);
  if (!list.ok) return { ok: false, error: list.detail };

  const devices = parseIosDevices(list.stdout);
  const selected =
    devices.find((device) => device.udid === nameOrUdid) ??
    devices.find((device) => device.name === nameOrUdid) ??
    devices.find((device) => device.name.includes(nameOrUdid));

  if (!selected) return { ok: false, error: `No available iOS simulator matched ${nameOrUdid}` };

  if (selected.state !== 'Booted') {
    const boot = command('xcrun', ['simctl', 'boot', selected.udid]);
    if (!boot.ok && !boot.detail.includes('Unable to boot device in current state: Booted')) {
      return { ok: false, error: boot.detail };
    }
    command('xcrun', ['simctl', 'bootstatus', selected.udid, '-b']);
  }

  return { ok: true, ...selected };
}

function parseIosDevices(json) {
  const parsed = JSON.parse(json);
  return Object.values(parsed.devices ?? {}).flat();
}

function command(cmd, commandArgs) {
  const result = spawnSync(cmd, commandArgs, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? '',
    detail: trim(result.stdout || result.stderr),
  };
}

function writeCaptureMetadata(path, metadata) {
  writeJson(path, metadata);
  return metadata;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function trim(value) {
  const text = String(value ?? '').trim();
  return text.length > 2_000 ? `${text.slice(0, 2_000)}...[truncated]` : text;
}

function targetValue(target) {
  const value = target.includes(':') ? target.slice(target.indexOf(':') + 1).trim() : '';
  return value || null;
}

function sanitizeFileName(value) {
  return String(value)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
