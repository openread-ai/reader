#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  buildActivityCaptureUrl,
  ensureDir,
  getActivityConfig,
  parseArgs,
  readCapturePlan,
  writeJson,
} from './common.mjs';

const AUTH_ENV_REFS = Object.freeze([
  'TEST_USER_EMAIL',
  'TEST_USER_PASSWORD',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
]);

export const NATIVE_FIXTURE_CATALOG = Object.freeze([
  {
    id: 'native-route',
    fixture: 'target.route/screen/state',
    status: 'implemented',
    adapter: 'openread://activity-capture deep link handled by ActivityCaptureBridge',
  },
  {
    id: 'native-onboarding',
    fixture: 'onboarding=skip',
    status: 'implemented',
    adapter: 'ActivityCaptureBridge sets welcome/onboarding localStorage flags',
  },
  {
    id: 'native-auth-anonymous',
    fixture: 'auth=anonymous',
    status: 'implemented',
    adapter: 'no native auth session setup required',
  },
  {
    id: 'native-auth-authenticated',
    fixture: 'auth=authenticated',
    status: 'guarded',
    adapter:
      'requires an already-seeded native app session or future secure app-side auth bootstrap; never passes raw secrets through deep links',
  },
  {
    id: 'native-book-any-library-book',
    fixture: 'book=first-library-book',
    status: 'guarded',
    adapter: 'ActivityCaptureBridge opens the first non-deleted native local-library book',
  },
  {
    id: 'native-theme-locale-permissions-network-subscription',
    fixture: 'theme/locale/permissions/network/subscription',
    status: 'planned-adapter-slots',
    adapter:
      'reserved fixture names that must block until an adapter is added for the Activity need',
  },
]);

export function resolveNativeTargets(nativeTargetsArg, platforms = []) {
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

export function buildNativeFixtureManifest({
  config,
  capturePlan,
  nativeTargets,
  openUrl = buildActivityCaptureUrl(capturePlan),
  mode = 'check',
}) {
  const target = capturePlan?.target ?? {};
  const fixtures = capturePlan?.fixtures ?? {};
  const adapters = [];
  const checks = [];
  const commands = nativeTargets.map((nativeTarget) => nativeCommandPlan(nativeTarget, config));

  adapters.push({
    id: 'native-route',
    status: openUrl ? 'ready' : 'skipped',
    fixture: {
      route: target.route ?? null,
      screen: target.screen ?? null,
      state: target.state ?? null,
      selector: target.selector ?? null,
    },
    application:
      'ActivityCaptureBridge receives openread://activity-capture and routes the native app to the requested screen/state.',
    openUrl,
  });

  adapters.push({
    id: 'native-onboarding',
    status: 'ready',
    fixture: { onboarding: 'skip' },
    application:
      'ActivityCaptureBridge sets has_seen_welcome and openread_onboarding_completed before opening the target.',
  });

  const authMode = fixtures.auth ?? 'anonymous';
  if (authMode === 'authenticated') {
    const authChecks = AUTH_ENV_REFS.map((name) => ({
      label: `${name} available by name for native auth fixture planning`,
      ok: Boolean(process.env[name]),
      envRef: name,
      secretRedacted: true,
    }));
    checks.push(...authChecks);
    const envReady = authChecks.every((check) => check.ok);
    const sessionReady = nativeAuthSessionReady();
    adapters.push({
      id: 'native-auth',
      status: envReady && sessionReady ? 'ready' : 'blocked',
      fixture: { auth: authMode, account: fixtures.account ?? null },
      envRefs: AUTH_ENV_REFS,
      application:
        'Native auth uses the Activity fixture contract: keep an existing native app session or add a secure app-side auth bootstrap before capture. Secrets are never written to the deep link.',
      limitation:
        'This adapter validates fixture prerequisites and avoids false-green native auth; it does not translate Playwright localStorage injection into native WebView state.',
      readiness:
        envReady && sessionReady
          ? 'Native authenticated session is declared ready by OPENREAD_NATIVE_AUTH_SESSION_READY=true.'
          : 'Set up an authenticated native app session, then set OPENREAD_NATIVE_AUTH_SESSION_READY=true for this shell, or add a secure native auth bootstrap adapter.',
    });
  } else {
    adapters.push({
      id: 'native-auth',
      status: 'ready',
      fixture: { auth: authMode },
      application: 'Anonymous native captures require no auth session setup.',
    });
  }

  const bookMode = fixtures.book?.mode ?? 'none';
  if (bookMode === 'any-library-book') {
    const libraryReady = nativeLibraryReady();
    adapters.push({
      id: 'native-book',
      status: libraryReady ? 'ready' : 'blocked',
      fixture: { book: 'first-library-book', library: fixtures.library ?? null },
      application:
        'ActivityCaptureBridge loads the native app library and opens the first non-deleted local book with a hash.',
      runtimeRequirement: 'Native app local library must contain at least one readable book.',
      readiness: libraryReady
        ? 'Native local library is declared ready by OPENREAD_NATIVE_LIBRARY_READY=true.'
        : 'Seed the native app local library with at least one readable book, then set OPENREAD_NATIVE_LIBRARY_READY=true for this shell.',
    });
  } else if (bookMode === 'title') {
    adapters.push({
      id: 'native-book',
      status: 'blocked',
      fixture: { bookMode, title: fixtures.book?.title ?? null },
      application:
        'Title-specific native book selection is not implemented; use any-library-book or add a native fixture adapter.',
    });
  } else {
    adapters.push({
      id: 'native-book',
      status: 'skipped',
      fixture: { bookMode },
      application: 'No native book fixture required for this target.',
    });
  }

  appendPlannedAdapterSlots(adapters, fixtures, capturePlan?.nativeFixtures ?? {});

  const blocked = adapters.filter((adapter) => adapter.status === 'blocked');
  const result = blocked.length > 0 ? 'blocked' : 'passed';

  return {
    schemaVersion: 1,
    stage: 'native-fixtures',
    result,
    mode,
    activityId: config.activityId,
    activityUuid: config.activityUuid,
    attemptId: config.attemptId,
    capturePlanPath: config.capturePlanPath,
    nativeTargets,
    target,
    fixtures,
    nativeFixturePlan: capturePlan?.nativeFixtures ?? {},
    openUrl,
    adapters,
    checks,
    commands,
    fixtureCatalog: NATIVE_FIXTURE_CATALOG,
    nextAction:
      result === 'passed'
        ? 'Use the generated native commands for Stage 4/8/9 native validation lanes.'
        : 'Add or adjust the blocked native fixture adapter before native validation can be approval-ready.',
    createdAt: new Date().toISOString(),
  };
}

export function writeNativeFixtureManifest(path, manifest) {
  writeJson(path, manifest);
  return manifest;
}

function appendPlannedAdapterSlots(adapters, fixtures, nativeFixtures) {
  const requested = {
    theme: fixtures.theme ?? nativeFixtures.theme,
    locale: fixtures.locale ?? nativeFixtures.locale,
    permissions: fixtures.permissions ?? nativeFixtures.permissions,
    network: fixtures.network ?? nativeFixtures.network,
    subscription: fixtures.subscription ?? nativeFixtures.subscription,
    installState: fixtures.installState ?? nativeFixtures.installState,
  };

  for (const [fixtureName, fixtureValue] of Object.entries(requested)) {
    if (fixtureValue === undefined || fixtureValue === null || fixtureValue === 'default') continue;
    adapters.push({
      id: `native-${fixtureName}`,
      status: 'blocked',
      fixture: { [fixtureName]: fixtureValue },
      application: `${fixtureName} native fixture adapter is reserved but not implemented yet.`,
      nextAction: `Add a native ${fixtureName} fixture adapter before approval-ready native validation uses this fixture.`,
    });
  }
}

function nativeAuthSessionReady() {
  return (
    process.env.OPENREAD_NATIVE_AUTH_SESSION_READY === 'true' ||
    process.env.OPENREAD_NATIVE_ASSUME_AUTHENTICATED === 'true'
  );
}

function nativeLibraryReady() {
  return (
    process.env.OPENREAD_NATIVE_LIBRARY_READY === 'true' ||
    process.env.OPENREAD_NATIVE_ASSUME_LIBRARY_READY === 'true'
  );
}

function nativeCommandPlan(nativeTarget, config) {
  const baseArgs = `--activity ${config.activityId} --attempt ${config.attemptId} --platforms ${nativeTarget.startsWith('android') ? 'android' : 'ios'}`;

  if (nativeTarget.startsWith('android')) {
    return {
      nativeTarget,
      warmCommand: `pnpm activity:android-smoke -- ${baseArgs} --warm-only --lock-wait-ms 300000`,
      captureCommand: `pnpm activity:stage4-native -- ${baseArgs} --native-targets ${nativeTarget} --lock-wait-ms 300000`,
    };
  }

  return {
    nativeTarget,
    warmCommand: `pnpm activity:stage4-native -- ${baseArgs} --native-targets ${nativeTarget} --warm-only --lock-wait-ms 300000`,
    captureCommand: `pnpm activity:stage4-native -- ${baseArgs} --native-targets ${nativeTarget} --lock-wait-ms 300000`,
  };
}

function loadFixtureEnv(root) {
  for (const file of ['.env.test.local', '.env.local', '.env']) {
    const path = resolve(root, file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (match && process.env[match[1]] === undefined) {
        process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
      }
    }
  }
}

function runCli() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    printHelp();
    return;
  }

  const config = getActivityConfig(process.argv.slice(2));
  loadFixtureEnv(process.cwd());

  const capturePlan = readCapturePlan(config);
  const nativeTargets = resolveNativeTargets(args.nativeTargets, config.platforms);
  const artifactDir = resolve(config.attemptDir, 'native-fixtures');
  const manifestPath = resolve(artifactDir, 'native-fixture-manifest.json');
  const openUrl =
    args.openUrl ?? process.env.OPENREAD_NATIVE_OPEN_URL ?? buildActivityCaptureUrl(capturePlan);

  ensureDir(artifactDir);
  const manifest = buildNativeFixtureManifest({
    config,
    capturePlan,
    nativeTargets,
    openUrl,
    mode: args.mode ?? 'check',
  });
  writeNativeFixtureManifest(manifestPath, manifest);

  console.log(JSON.stringify({ result: manifest.result, manifestPath, manifest }, null, 2));
  process.exit(manifest.result === 'blocked' ? 1 : 0);
}

function printHelp() {
  console.log(`Native fixture manifest

Usage:
  pnpm activity:native-fixtures --activity <id> --attempt <id> --platforms ios,android [options]

Options:
  --native-targets <targets>  Comma-separated native targets, e.g. ios-simulator,android-device
  --open-url <url>           Override the generated activity-capture deep link
  --mode <name>              Manifest mode label: check, warm, capture, validation
`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runCli();
}
