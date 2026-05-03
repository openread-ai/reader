#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { getActivityConfig, parseArgs, writeJson } from './common.mjs';

const args = parseArgs(process.argv.slice(2));
const config = getActivityConfig(process.argv.slice(2));
const startedAtMs = Date.now();
const intent = args.intent ?? process.env.OPENREAD_ACTIVITY_INTENT;

if (!intent) {
  fail(
    'Capture planning requires --intent. The activity-run skill should derive this from Notion.',
  );
}

if (existsSync(config.capturePlanPath) && args.force !== true) {
  fail(`Capture plan already exists: ${config.capturePlanPath}. Pass --force to replace it.`);
}

const screen = String(args.screen ?? inferScreen(intent)).toLowerCase();
const plan = buildPlan({
  config,
  intent,
  screen,
  route: args.route,
  selector: args.selector,
  platforms: inferPlatforms(intent, config.platforms),
});

writeJson(config.capturePlanPath, plan);
console.log(
  JSON.stringify(
    {
      result: 'created',
      capturePlanPath: config.capturePlanPath,
      plan,
      durationMs: Date.now() - startedAtMs,
    },
    null,
    2,
  ),
);

function buildPlan({ config, intent, screen, route, selector, platforms }) {
  const base = {
    schemaVersion: 1,
    stage: 'capture-planning',
    activityId: config.activityId,
    activityUuid: config.activityUuid,
    intent,
    confidence: screen === 'unknown' ? 'low' : 'medium',
    platforms,
    createdAt: new Date().toISOString(),
  };

  if (screen === 'reader') {
    return {
      ...base,
      target: {
        screen: 'reader',
        route: route ?? '/reader',
        selector: selector ?? 'body',
        state: 'reader-open-with-inline-question-bar-visible',
      },
      fixtures: {
        auth: 'authenticated',
        account: 'shared-test-account',
        book: {
          mode: args.bookTitle ? 'title' : 'any-library-book',
          title: args.bookTitle ?? null,
          source: args.bookTitle
            ? 'shared-test-account-library'
            : 'shared-test-account-existing-books',
        },
        library: 'seeded-library-with-at-least-one-book',
      },
      nativeFixtures: {
        requiredAdapters: ['native-route', 'native-onboarding', 'native-auth', 'native-book'],
        auth: 'authenticated',
        onboarding: 'skip',
        book: args.bookTitle ? 'title' : 'first-library-book',
        nativeTargets: defaultNativeTargets(platforms),
      },
      openQuestions: args.bookTitle ? [] : ['Using first available seeded library book.'],
    };
  }

  return {
    ...base,
    target: {
      screen,
      route: route ?? defaultRouteForScreen(screen),
      selector: selector ?? 'body',
      state: 'default-load',
    },
    fixtures: {
      auth: screenRequiresAuth(screen) ? 'authenticated' : 'anonymous',
      account: screenRequiresAuth(screen) ? 'shared-test-account' : 'none',
      book: { mode: 'none', title: null },
      library: 'not-required',
    },
    nativeFixtures: {
      requiredAdapters: ['native-route', 'native-onboarding', 'native-auth'],
      auth: screenRequiresAuth(screen) ? 'authenticated' : 'anonymous',
      onboarding: 'skip',
      nativeTargets: defaultNativeTargets(platforms),
    },
    openQuestions:
      screen === 'unknown' ? ['Agent should resolve the app screen before capture.'] : [],
  };
}

function inferPlatforms(value, fallback) {
  const text = String(value).toLowerCase();
  if (
    text.includes('all configured browser/mobile') ||
    text.includes('all supported') ||
    text.includes('all platforms') ||
    text.includes('five-platform') ||
    text.includes('5 platform')
  ) {
    return ['web', 'macos', 'windows', 'ios', 'android'];
  }
  return fallback;
}

function inferScreen(value) {
  const text = String(value).toLowerCase();
  if (text.includes('reader') || text.includes('book') || text.includes('toolbar')) return 'reader';
  if (text.includes('library')) return 'library';
  if (text.includes('settings')) return 'settings';
  if (text.includes('explore')) return 'explore';
  if (text.includes('home')) return 'home';
  return 'unknown';
}

function defaultNativeTargets(platforms) {
  const targets = [];
  if (platforms.includes('ios')) targets.push('ios-simulator');
  if (platforms.includes('android')) targets.push('android-device');
  return targets;
}

function defaultRouteForScreen(screen) {
  if (screen === 'library') return '/library';
  if (screen === 'settings') return '/settings';
  if (screen === 'explore') return '/explore';
  if (screen === 'home') return '/home';
  return '/';
}

function screenRequiresAuth(screen) {
  return ['reader', 'library', 'settings', 'home'].includes(screen);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
