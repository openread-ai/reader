#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
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
  resolveAndroidSdkRoot,
  writeJson,
} from './common.mjs';
import { buildNativeFixtureManifest, writeNativeFixtureManifest } from './native-fixtures.mjs';

const config = getActivityConfig(process.argv.slice(2));
const args = parseArgs(process.argv.slice(2));
if (args.help || args.h) {
  printHelp();
  process.exit(0);
}
const startedAtMs = Date.now();
const startedAt = new Date(startedAtMs).toISOString();
const appRoot = process.cwd();
const artifactDir = resolve(config.attemptDir, 'android-platform-smoke');
const avdName = args.avd ?? process.env.OPENREAD_ANDROID_AVD ?? 'Openread_Pixel_8_API_35';
const androidPackage =
  args.androidPackage ?? process.env.OPENREAD_ANDROID_PACKAGE ?? 'com.reglity.openread';
const capturePlan = readCapturePlan(config);
const openUrl =
  args.openUrl ?? process.env.OPENREAD_ANDROID_OPEN_URL ?? buildActivityCaptureUrl(capturePlan);
const delayMs = Number(args.delayMs ?? process.env.OPENREAD_ANDROID_SMOKE_DELAY_MS ?? 2_000);
const serial = args.androidSerial ?? process.env.ANDROID_SERIAL ?? null;
const warmOnly =
  args.warmOnly === true ||
  args.warmOnly === 'true' ||
  process.env.OPENREAD_ANDROID_WARM_ONLY === 'true';
const build = !warmOnly && args.build !== false && args.build !== 'false';
const install = !warmOnly && args.install !== false && args.install !== 'false';
const launch = !warmOnly && args.launch !== false && args.launch !== 'false';
const screenshotPath = resolve(artifactDir, 'android-smoke.png');
const sdkRoot = resolveAndroidSdkRoot();
const ndkHome = resolveAndroidNdkHome(sdkRoot);
const env = {
  ...process.env,
  ...(sdkRoot ? { ANDROID_HOME: sdkRoot, ANDROID_SDK_ROOT: sdkRoot } : {}),
  ...(ndkHome ? { NDK_HOME: ndkHome } : {}),
};
const lockWaitMs = Number(args.lockWaitMs ?? process.env.OPENREAD_ACTIVITY_LOCK_WAIT_MS ?? 0);

ensureDir(artifactDir);
const nativeFixtureManifestPath = resolve(artifactDir, 'native-fixture-manifest.json');
const nativeFixtureManifest = writeNativeFixtureManifest(
  nativeFixtureManifestPath,
  buildNativeFixtureManifest({
    config,
    capturePlan,
    nativeTargets: ['android-device'],
    openUrl,
    mode: warmOnly ? 'warm' : 'smoke',
  }),
);

const steps = [
  check(
    'Native Android fixtures are expandable',
    nativeFixtureManifest.result !== 'blocked',
    nativeFixtureManifest.result,
  ),
];
let platformLock = null;

try {
  platformLock = acquirePlatformLock({
    platform: 'android',
    owner: `${config.activityId}/${config.attemptId}/android-platform-smoke`,
    waitMs: lockWaitMs,
  });
  steps.push(check('Android platform lock acquired', true, platformLock.lock));
} catch (error) {
  steps.push(check('Android platform lock acquired', false, error.message));
}

steps.push(check('Android SDK root exists', Boolean(sdkRoot), sdkRoot));
if (!warmOnly) steps.push(check('Android NDK exists', Boolean(ndkHome), ndkHome));
steps.push(commandStep('adb version', androidTool('adb'), ['version']));
steps.push(
  commandStep('Android emulator AVDs are listable', androidTool('emulator'), ['-list-avds']),
);

if (steps.every((step) => step.ok)) {
  const deviceStep = ensureAndroidDevice();
  steps.push(deviceStep);

  if (deviceStep.ok && warmOnly) {
    steps.push(
      check('Android emulator/device is warmed for native testing', true, serial ?? avdName),
    );
  }

  if (deviceStep.ok && build) {
    steps.push(
      commandStep(
        'Tauri Android debug APK builds',
        'pnpm',
        [
          'tauri',
          'android',
          'build',
          '--debug',
          '--apk',
          'true',
          '--aab',
          'false',
          '--target',
          'aarch64',
          '--ci',
        ],
        { timeoutMs: 900_000 },
      ),
    );
  }

  if (!warmOnly) {
    const apkPath = findNewestApk(resolve(appRoot, 'src-tauri/gen/android'));
    if (build || install)
      steps.push(check('Android APK artifact exists', Boolean(apkPath), apkPath));

    if (deviceStep.ok && install && apkPath) {
      steps.push(
        commandStep(
          'APK installs on Android device',
          androidTool('adb'),
          adbArgs(['install', '-r', apkPath]),
          { timeoutMs: 180_000 },
        ),
      );
    }

    if (deviceStep.ok && launch) {
      steps.push(launchAndroidApp());
    }

    if (deviceStep.ok) {
      if (launch) sleep(delayMs);
      steps.push(captureAndroidScreenshot(screenshotPath));
    }
  }
}

const failed = steps.filter((step) => !step.ok);
const result = failed.length > 0 ? 'failed' : 'passed';
const report = {
  schemaVersion: 1,
  stage: 'android-platform-smoke',
  result,
  activityId: config.activityId,
  activityUuid: config.activityUuid,
  attemptId: config.attemptId,
  avdName,
  androidPackage,
  openUrl,
  delayMs,
  warmOnly,
  nativeFixtureManifestPath,
  nativeFixtures: nativeFixtureManifest,
  sdkRoot,
  ndkHome,
  artifactDir,
  screenshotPath,
  steps,
  nextAction:
    result === 'passed'
      ? warmOnly
        ? 'Android emulator/device is booted and ready for native Android work.'
        : 'Run Stage 4 native Android capture against the installed app.'
      : 'Fix failed Android platform smoke checks and retry with a new attempt.',
  startedAt,
  finishedAt: new Date().toISOString(),
  durationMs: Date.now() - startedAtMs,
  createdAt: startedAt,
};

writeJson(resolve(artifactDir, 'android-smoke-report.json'), report);
console.log(JSON.stringify(report, null, 2));
releasePlatformLock(platformLock);
process.exit(result === 'failed' ? 1 : 0);

function ensureAndroidDevice() {
  const adb = androidTool('adb');
  const devices = command(adb, ['devices']);
  if (hasDevice(devices.stdout, serial)) {
    return {
      label: 'Android emulator/device is connected',
      ok: true,
      detail: devices.stdout.trim(),
    };
  }

  const emulator = androidTool('emulator');
  spawn(emulator, ['-avd', avdName, '-no-snapshot-load', '-no-audio', '-no-boot-anim'], {
    detached: true,
    stdio: 'ignore',
    env,
  }).unref();

  const wait = command(adb, adbArgs(['wait-for-device']), { timeoutMs: 240_000 });
  if (!wait.ok) return { label: 'Android emulator boots', ok: false, detail: wait.detail };

  for (let index = 0; index < 90; index += 1) {
    const booted = command(adb, adbArgs(['shell', 'getprop', 'sys.boot_completed']));
    if (booted.stdout.trim() === '1') {
      return { label: 'Android emulator boots', ok: true, detail: avdName };
    }
    sleep(2_000);
  }

  return { label: 'Android emulator boots', ok: false, detail: `Timed out waiting for ${avdName}` };
}

function launchAndroidApp() {
  if (openUrl) {
    return commandStep(
      'Android app opens activity deep link',
      androidTool('adb'),
      adbArgs(['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', openUrl]),
    );
  }

  return commandStep(
    'Android app launches',
    androidTool('adb'),
    adbArgs(['shell', 'am', 'start', '-n', `${androidPackage}/.MainActivity`]),
  );
}

function captureAndroidScreenshot(path) {
  const adb = androidTool('adb');
  const screenshot = spawnSync(adb, adbArgs(['exec-out', 'screencap', '-p']), {
    cwd: appRoot,
    env,
    encoding: 'buffer',
    timeout: 120_000,
    maxBuffer: 25 * 1024 * 1024,
  });
  const stdout = screenshot.stdout ?? Buffer.alloc(0);

  if (screenshot.status === 0 && stdout.length > 0) {
    writeFileSync(path, stdout);
  }

  return {
    label: 'Android smoke screenshot captured',
    ok: screenshot.status === 0 && existsSync(path),
    path,
    detail: screenshot.status === 0 ? path : trim(screenshot.stderr || stdout),
  };
}

function resolveAndroidNdkHome(root) {
  if (process.env.NDK_HOME && existsSync(process.env.NDK_HOME)) return process.env.NDK_HOME;
  if (!root) return null;

  const ndkRoot = resolve(root, 'ndk');
  if (!existsSync(ndkRoot)) return null;

  return readdirSync(ndkRoot)
    .map((name) => resolve(ndkRoot, name))
    .filter((path) => statSync(path).isDirectory())
    .sort()
    .at(-1);
}

function findNewestApk(root) {
  if (!existsSync(root)) return null;
  const apks = collectFiles(root).filter((file) => file.endsWith('.apk'));
  return apks.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? null;
}

function collectFiles(path) {
  return readdirSync(path).flatMap((entry) => {
    const child = resolve(path, entry);
    const stats = statSync(child);
    return stats.isDirectory() ? collectFiles(child) : [child];
  });
}

function commandStep(label, executable, commandArgs, options = {}) {
  const result = command(executable, commandArgs, options);
  return { label, ok: result.ok, command: result.command, detail: result.detail };
}

function adbArgs(commandArgs) {
  return serial ? ['-s', serial, ...commandArgs] : commandArgs;
}

function command(executable, commandArgs, options = {}) {
  const result = spawnSync(executable, commandArgs, {
    cwd: appRoot,
    env,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 120_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  return {
    ok: result.status === 0,
    command: `${executable} ${commandArgs.join(' ')}`,
    stdout: result.stdout ?? '',
    detail: trim(result.status === 0 ? result.stdout : result.stderr || result.stdout),
  };
}

function check(label, ok, detail) {
  return { label, ok, detail };
}

function hasDevice(output, expectedSerial) {
  return output.split('\n').some((line) => {
    const match = line.trim().match(/^(\S+)\s+device$/);
    return match && (!expectedSerial || match[1] === expectedSerial);
  });
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function trim(value) {
  return String(value ?? '').trim();
}

function printHelp() {
  console.log(`Android platform smoke

Usage:
  pnpm activity:android-smoke --activity <id> --attempt <id> --platforms android [options]

Options:
  --avd <name>                 AVD to boot when no device is connected
  --android-serial <serial>    adb serial to target
  --android-package <package>  Android package to launch
  --open-url <url>             Deep link to open before screenshot
  --delay-ms <ms>              Wait after launch before screenshot
  --lock-wait-ms <ms>          Wait for another native Android lane to finish
  --warm-only                  Boot/connect Android under the platform lock; skip build/install/launch/capture
  --build false                Skip debug APK build
  --install false              Skip APK install
  --launch false               Skip launch/deep-link
`);
}
