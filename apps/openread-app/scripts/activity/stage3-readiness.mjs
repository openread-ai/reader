#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  ensureDir,
  fileCheck,
  androidTool,
  getActivityConfig,
  readCapturePlan,
  resolveAndroidSdkRoot,
  resolveProjects,
  writeJson,
} from './common.mjs';

const config = getActivityConfig(process.argv.slice(2));
const startedAtMs = Date.now();
const startedAt = new Date(startedAtMs).toISOString();
const args = process.argv.slice(2);
const nativeTargets = getNativeTargets(args);
const appRoot = process.cwd();
const checks = [];
const warnings = [];
const capturePlan = readCapturePlan(config);

loadEnvFiles(appRoot, ['.env.test.local', '.env.local', '.env']);

ensureDir(config.stage3Dir);

checks.push(fileCheck(resolve(appRoot, 'package.json'), 'openread-app package.json exists'));
checks.push(fileCheck(resolve(appRoot, 'node_modules'), 'worktree node_modules is linked'));
checks.push(fileCheck(resolve(appRoot, 'playwright.config.ts'), 'Playwright config exists'));
checks.push(
  fileCheck(
    resolve(appRoot, 'e2e/tests/activity/current-capture.spec.ts'),
    'Stage 4 capture spec exists',
  ),
);
checks.push(
  fileCheck(
    resolve(appRoot, 'scripts/activity/stage4-native-capture.mjs'),
    'Stage 4 native capture script exists',
  ),
);
checks.push(
  fileCheck(
    resolve(appRoot, '.env.web.example'),
    '.env.web.example exists for optional dev-web overrides',
  ),
);
checks.push(fileCheck(config.capturePlanPath, 'capture-plan.json exists'));
checks.push(
  fileCheck(resolve(appRoot, 'public/vendor/pdfjs/pdf.min.mjs'), 'PDF.js runtime bundle exists'),
);
checks.push(
  fileCheck(
    resolve(appRoot, 'public/vendor/pdfjs/pdf.worker.min.mjs'),
    'PDF.js worker bundle exists',
  ),
);
checks.push(
  fileCheck(resolve(appRoot, 'public/vendor/pdfjs/openjpeg.wasm'), 'PDF.js OpenJPEG WASM exists'),
);
checks.push(
  fileCheck(
    resolve(appRoot, 'public/vendor/simplecc/simplecc_wasm.js'),
    'SimpleCC JS vendor asset exists',
  ),
);
checks.push(
  fileCheck(
    resolve(appRoot, 'public/vendor/simplecc/simplecc_wasm_bg.wasm'),
    'SimpleCC WASM vendor asset exists',
  ),
);

const packageJsonPath = resolve(appRoot, 'package.json');
if (existsSync(packageJsonPath)) {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  checks.push({
    label: 'dev-web script exists',
    severity: 'error',
    ok: Boolean(packageJson.scripts?.['dev-web']),
  });
}

const playwrightVersion = spawnSync('pnpm', ['exec', 'playwright', '--version'], {
  cwd: appRoot,
  encoding: 'utf8',
});
checks.push({
  label: 'Playwright CLI is available',
  severity: 'error',
  ok: playwrightVersion.status === 0,
  detail:
    playwrightVersion.status === 0
      ? playwrightVersion.stdout.trim()
      : playwrightVersion.stderr.trim(),
});

const configText = existsSync(resolve(appRoot, 'playwright.config.ts'))
  ? readFileSync(resolve(appRoot, 'playwright.config.ts'), 'utf8')
  : '';
const effectivePlatforms = capturePlan?.platforms ?? config.platforms;
const projectMappings = resolveProjects(effectivePlatforms);
for (const mapping of projectMappings) {
  const projectConfigured =
    configText.includes(`name: '${mapping.project}'`) ||
    configText.includes(`name: "${mapping.project}"`);
  checks.push({
    label: `Playwright project configured for ${mapping.platform}`,
    severity: 'error',
    ok: projectConfigured,
    project: mapping.project,
    recognizedPlatform: mapping.recognizedPlatform,
  });
}

if (capturePlan?.fixtures?.auth === 'authenticated') {
  checks.push(
    fileCheck(
      resolve(appRoot, '.env.test.local'),
      '.env.test.local exists for authenticated fixtures',
    ),
  );
  for (const envName of [
    'TEST_USER_EMAIL',
    'TEST_USER_PASSWORD',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  ]) {
    checks.push({
      label: `${envName} is available for authenticated fixtures`,
      severity: 'error',
      ok: Boolean(process.env[envName]),
    });
  }
}

if (capturePlan?.fixtures?.book?.mode === 'any-library-book') {
  warnings.push(
    'Stage 4 will require the authenticated test user to have at least one seeded library book.',
  );
}

if (capturePlan?.target?.screen === 'reader' && capturePlan?.fixtures?.auth === 'authenticated') {
  for (const envName of [
    'SUPABASE_SERVICE_ROLE_KEY',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_ACCOUNT_ID',
  ]) {
    checks.push({
      label: `${envName} is available for authenticated reader capture`,
      severity: 'error',
      ok: Boolean(process.env[envName]),
    });
  }
  checks.push({
    label: 'R2 bucket is configured for authenticated reader capture',
    severity: 'error',
    ok: Boolean(process.env.R2_BUCKET || process.env.R2_BUCKET_NAME),
  });
}

if (projectMappings.some((mapping) => mapping.project === 'msedge')) {
  checks.push({
    label: 'Microsoft Edge is installed for windows/msedge Playwright lane',
    severity: 'error',
    ok: msedgeAvailable(),
    detail:
      'windows maps to Playwright project msedge, which requires a system Microsoft Edge install. Install with `pnpm --filter @openread/openread-app exec playwright install msedge` or install Microsoft Edge manually.',
  });
}

if (
  nativeTargets.length === 0 &&
  projectMappings.some((mapping) => ['mobile-webkit', 'mobile-chromium'].includes(mapping.project))
) {
  warnings.push(
    'mobile platform capture is browser/viewport emulation, not a real iOS or Android device.',
  );
}

if (
  nativeTargets.length === 0 &&
  config.platforms.some((platform) => ['ios', 'android'].includes(platform))
) {
  warnings.push(
    'No real native targets requested. Pass --native-targets ios-simulator,ios-device,android-emulator,android-device to validate device readiness.',
  );
}

for (const target of nativeTargets) {
  checks.push(...nativeReadinessChecks(target));
}

const failed = checks.filter((check) => check.severity !== 'warning' && !check.ok);
const warningChecks = checks.filter((check) => check.severity === 'warning' && !check.ok);
const result = failed.length > 0 ? 'failed' : warningChecks.length > 0 ? 'partial' : 'passed';

const report = {
  schemaVersion: 1,
  stage: 'stage-3-readiness',
  result,
  activityId: config.activityId,
  activityUuid: config.activityUuid,
  attemptId: config.attemptId,
  route: config.route,
  selector: config.selector,
  capturePlanPath: config.capturePlanPath,
  capturePlan,
  platforms: effectivePlatforms,
  projects: projectMappings,
  artifactDir: config.stage3Dir,
  checks,
  warnings,
  nextAction:
    result === 'failed'
      ? 'Fix failed readiness checks before current-state capture.'
      : 'Run Stage 4 current-state capture for the requested platforms.',
  startedAt,
  finishedAt: new Date().toISOString(),
  durationMs: Date.now() - startedAtMs,
  createdAt: startedAt,
};

writeJson(resolve(config.stage3Dir, 'readiness-report.json'), report);
console.log(JSON.stringify(report, null, 2));

if (result === 'failed') {
  process.exit(1);
}

function getNativeTargets(argv) {
  const nativeArg = argv.find((arg) => arg.startsWith('--native-targets'));
  const inlineValue = nativeArg?.includes('=') ? nativeArg.split('=')[1] : null;
  const nextValue = nativeArg && !inlineValue ? argv[argv.indexOf(nativeArg) + 1] : null;
  const value = inlineValue ?? process.env.OPENREAD_NATIVE_TARGETS ?? nextValue ?? '';
  return value
    .split(',')
    .map((target) => target.trim())
    .filter(Boolean);
}

function msedgeAvailable() {
  const candidates = [
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    resolve(
      process.env.HOME ?? '',
      'Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ),
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ];
  if (candidates.some((candidate) => existsSync(candidate))) return true;

  const lookup = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['msedge'], {
    encoding: 'utf8',
  });
  return lookup.status === 0;
}

function nativeReadinessChecks(target) {
  if (target === 'ios-simulator' || target.startsWith('ios-simulator:')) {
    return [
      commandCheck('xcodebuild is available', 'xcodebuild', ['-version']),
      commandCheck('iOS simulators are listable', 'xcrun', [
        'simctl',
        'list',
        'devices',
        'available',
      ]),
    ];
  }

  if (target === 'ios-device') {
    return [
      commandCheck('xcodebuild is available', 'xcodebuild', ['-version']),
      commandCheck('ios-deploy is available for real iPhone capture', 'ios-deploy', ['--version']),
    ];
  }

  if (target === 'android-emulator') {
    return [
      androidSdkCheck(),
      commandCheck('adb is available', androidTool('adb'), ['version']),
      commandCheck('Android emulator is available', androidTool('emulator'), ['-list-avds']),
    ];
  }

  if (target === 'android-device') {
    return [
      androidSdkCheck(),
      commandCheck('adb is available', androidTool('adb'), ['version']),
      commandCheck('adb can list connected devices', androidTool('adb'), ['devices']),
    ];
  }

  return [{ label: `Unknown native target ${target}`, severity: 'error', ok: false }];
}

function commandCheck(label, command, commandArgs) {
  const result = spawnSync(command, commandArgs, { encoding: 'utf8' });
  return {
    label,
    severity: 'error',
    ok: result.status === 0,
    command: `${command} ${commandArgs.join(' ')}`,
    detail: result.status === 0 ? trim(result.stdout) : trim(result.stderr || result.stdout),
  };
}

function androidSdkCheck() {
  const sdkRoot = resolveAndroidSdkRoot();
  return {
    label: 'Android SDK root is available',
    severity: 'error',
    ok: Boolean(sdkRoot),
    path: sdkRoot,
  };
}

function loadEnvFiles(root, files) {
  for (const file of files) {
    const path = resolve(root, file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
      }
    }
  }
}

function trim(value) {
  const text = String(value ?? '').trim();
  return text.length > 1_000 ? `${text.slice(0, 1_000)}...[truncated]` : text;
}
