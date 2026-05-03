import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { basename, relative, resolve } from 'node:path';
import { getProbeBatch } from '../e2e/probes/manifest.mjs';

const batch = process.argv[2] || 'critical';
const dryRun = process.argv.includes('--dry-run');
const restart = process.argv.includes('--restart');
const restartServer =
  process.argv.includes('--restart-server') ||
  process.env.OPENREAD_AI_PROBES_RESTART_SERVER === 'true';
const outputDir = 'test-results/ai-probes/artifacts';
const resultsDir = 'test-results/ai-probes/results';
const activityId = process.env.OPENREAD_ACTIVITY_ID;
const activityUuid = process.env.OPENREAD_ACTIVITY_UUID;
const attemptId = process.env.OPENREAD_ACTIVITY_ATTEMPT;
const attemptSuffix = attemptId ? `-${safeName(attemptId)}` : '';
const progressPath = `test-results/ai-probes/progress${attemptSuffix}.json`;
const resultsPath = `test-results/ai-probes/results${attemptSuffix}.json`;
const stage8Dir = process.env.OPENREAD_STAGE8_DIR;
const notionPageId = process.env.OPENREAD_NOTION_ACTIVITY_PAGE_ID;
const probes = getProbeBatch(batch);
const probeTimeoutMs = Number(process.env.OPENREAD_AI_PROBE_TIMEOUT_MS ?? 4 * 60_000);
const probeProjects = parseProbeProjects(process.env.OPENREAD_AI_PROBE_PROJECTS ?? 'chromium');

if (probes.length === 0) {
  console.error(`No AI probes configured for batch: ${batch}`);
  process.exit(1);
}

mkdirSync('test-results/ai-probes', { recursive: true });
mkdirSync(outputDir, { recursive: true });
mkdirSync(resultsDir, { recursive: true });

if (restart || !existsSync(progressPath)) {
  rmSync(resultsPath, { force: true });
  rmSync(outputDir, { recursive: true, force: true });
  rmSync(resultsDir, { recursive: true, force: true });
  if (restart) rmSync(progressPath, { force: true });
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(resultsDir, { recursive: true });
}

console.log(`Running AI probe batch: ${batch}`);
console.log(`AI probe progress: ${progressPath}`);
console.log(`AI probe results: ${resultsPath}`);
for (const probe of probes) {
  console.log(`- ${probe.id}: ${probe.specPath}`);
}

if (dryRun) {
  console.log('Dry run only; not invoking Playwright.');
  process.exit(0);
}

const progress = loadProgress();
recoverStaleRunningProbes();
if (restartServer) stopExistingDevServer();
let hasFailures = false;

for (const probe of probes) {
  const previous = progress.probes[probe.id];
  if (previous?.completed === true) {
    if (previous.status === 'failed' && previous.staleRecovered === true) {
      console.log(`Retrying ${probe.id}; previous failure was stale-recovered.`);
    } else {
      console.log(`Skipping ${probe.id}; already ${previous.status}.`);
      if (previous.status !== 'passed') hasFailures = true;
      continue;
    }
  }

  const startedAt = new Date().toISOString();
  const probeOutputDir = `${outputDir}/${safeName(probe.id)}`;
  const resultPath = `${resultsDir}/${safeName(probe.id)}.json`;

  progress.probes[probe.id] = {
    ...probe,
    status: 'running',
    completed: false,
    startedAt,
    outputDir: probeOutputDir,
    resultPath,
  };
  writeProgress(progress);
  writeValidationCheckpoint({ currentProbe: probe.id });
  syncValidationCheckpoint(`▶️ Validation probe started: ${probe.id}`);

  console.log(`Starting ${probe.id}: ${probe.specPath}`);
  rmSync(probeOutputDir, { recursive: true, force: true });
  mkdirSync(probeOutputDir, { recursive: true });

  const started = Date.now();
  let exitCode = 0;
  let errorMessage = null;
  try {
    execFileSync(
      'pnpm',
      [
        'exec',
        'playwright',
        'test',
        '--reporter=line,json',
        '--max-failures=1',
        '--retries=0',
        ...probeProjectArgs(),
        `--output=${probeOutputDir}`,
        probe.specPath,
      ],
      {
        env: {
          ...process.env,
          OPENREAD_PLAYWRIGHT_SCREENSHOT: 'on',
          PLAYWRIGHT_JSON_OUTPUT_NAME: resultPath,
          PLAYWRIGHT_HTML_OPEN: 'never',
          OPENREAD_E2E_REUSE_SERVER: 'false',
        },
        stdio: 'inherit',
        timeout: probeTimeoutMs,
        killSignal: 'SIGTERM',
      },
    );
  } catch (error) {
    exitCode = typeof error.status === 'number' ? error.status : 1;
    errorMessage = error.message ?? String(error);
    if (error.signal) errorMessage = `${errorMessage}; signal=${error.signal}`;
  }

  const status = exitCode === 0 ? 'passed' : 'failed';
  const copiedScreenshots = copyProbeScreenshots({ probe, probeOutputDir });
  const notionUpload = uploadProbeScreenshots({ probe, screenshots: copiedScreenshots });

  progress.probes[probe.id] = {
    ...progress.probes[probe.id],
    status,
    completed: true,
    exitCode,
    errorMessage,
    timedOut: status === 'failed' && Date.now() - started >= probeTimeoutMs,
    probeTimeoutMs,
    durationMs: Date.now() - started,
    finishedAt: new Date().toISOString(),
    screenshots: copiedScreenshots,
    screenshotCount: copiedScreenshots.length,
    notionUpload,
  };
  writeProgress(progress);
  writeValidationCheckpoint({ currentProbe: null });
  syncValidationCheckpoint(
    `${status === 'passed' ? '✅' : '❌'} Validation probe ${status}: ${probe.id}; screenshots=${copiedScreenshots.length}`,
  );

  console.log(
    `Finished ${probe.id}: ${status}; screenshots=${copiedScreenshots.length}; notion=${notionUpload?.result ?? 'not-configured'}`,
  );
  if (status !== 'passed') hasFailures = true;
}

progress.finishedAt = new Date().toISOString();
progress.status = hasFailures ? 'failed' : 'passed';
writeProgress(progress);
writeValidationCheckpoint({ currentProbe: null, final: true });
writeFileSync(resultsPath, JSON.stringify(progress, null, 2));
process.exit(hasFailures ? 1 : 0);

function writeValidationCheckpoint({ currentProbe = null, final = false } = {}) {
  if (!stage8Dir || !activityId || !attemptId) return;
  const summary = progressSummary({ currentProbe });
  writeFileSync(
    resolve(stage8Dir, 'validation-checkpoint-report.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        stage: 'stage-8-validation',
        result: final ? progress.status : 'partial',
        activityId,
        activityUuid: activityUuid || null,
        attemptId,
        artifactDir: stage8Dir,
        probeProgress: summary,
        playwrightEvidence: {
          runner: 'Playwright',
          screenshotPolicy: 'on',
          artifactDir: resolve(stage8Dir, 'playwright-evidence'),
          screenshotCount: summary.screenshotCount,
        },
        nextAction: final
          ? 'Review validation report and proceed to validation verdict.'
          : `Resume Stage 8 from ${summary.nextProbeId ?? 'finalization'}.`,
        startedAt: progress.startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - Date.parse(progress.startedAt ?? new Date().toISOString()),
        probeTimeoutMs,
        probeProjects: probeProjects ?? 'all',
      },
      null,
      2,
    ),
  );
}

function progressSummary({ currentProbe = null } = {}) {
  const entries = probes.map((probe) => progress.probes[probe.id]).filter(Boolean);
  const completed = entries.filter((entry) => entry.completed === true);
  const failed = completed.filter((entry) => entry.status !== 'passed');
  const nextProbe = probes.find((probe) => progress.probes[probe.id]?.completed !== true);
  return {
    batch,
    total: probes.length,
    completed: completed.length,
    passed: completed.length - failed.length,
    failed: failed.length,
    currentProbe,
    nextProbeId: nextProbe?.id ?? null,
    screenshotCount: completed.reduce((sum, entry) => sum + (entry.screenshotCount ?? 0), 0),
    probes: probes.map((probe) => ({
      id: probe.id,
      status: progress.probes[probe.id]?.status ?? 'pending',
      completed: progress.probes[probe.id]?.completed === true,
      screenshotCount: progress.probes[probe.id]?.screenshotCount ?? 0,
      startedAt: progress.probes[probe.id]?.startedAt ?? null,
      finishedAt: progress.probes[probe.id]?.finishedAt ?? null,
      durationMs: progress.probes[probe.id]?.durationMs ?? null,
      timedOut: progress.probes[probe.id]?.timedOut === true,
      staleRecovered: progress.probes[probe.id]?.staleRecovered === true,
    })),
  };
}

function recoverStaleRunningProbes() {
  let recovered = false;
  for (const probe of probes) {
    const entry = progress.probes?.[probe.id];
    if (!entry || entry.completed === true || entry.status !== 'running') continue;

    if (hasActiveProbeProcess(probe)) {
      console.error(
        `Probe ${probe.id} is already running in another process. Stop that process before resuming.`,
      );
      process.exit(2);
    }

    const probeOutputDir = entry.outputDir ?? `${outputDir}/${safeName(probe.id)}`;
    const startedMs = Date.parse(entry.startedAt ?? '') || Date.now();
    const copiedScreenshots = copyProbeScreenshots({ probe, probeOutputDir });
    const notionUpload = uploadProbeScreenshots({ probe, screenshots: copiedScreenshots });
    progress.probes[probe.id] = {
      ...entry,
      status: 'pending',
      completed: false,
      exitCode: 124,
      errorMessage:
        'Recovered stale running probe: no active Playwright process existed on resume; probe will be retried.',
      staleRecovered: true,
      timedOut: Date.now() - startedMs >= probeTimeoutMs,
      probeTimeoutMs,
      durationMs: Date.now() - startedMs,
      finishedAt: new Date().toISOString(),
      screenshots: copiedScreenshots,
      screenshotCount: copiedScreenshots.length,
      notionUpload,
    };
    writeProgress(progress);
    writeValidationCheckpoint({ currentProbe: null });
    syncValidationCheckpoint(
      `↻ Validation probe stale-recovered for retry: ${probe.id}; screenshots=${copiedScreenshots.length}`,
    );
    console.log(
      `Recovered stale probe ${probe.id}: pending retry; screenshots=${copiedScreenshots.length}; notion=${notionUpload?.result ?? 'not-configured'}`,
    );
    recovered = true;
  }
  if (recovered) writeProgress(progress);
}

function hasActiveProbeProcess(probe) {
  const child = spawnSync('pgrep', ['-fl', probe.specPath], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (child.status !== 0) return false;
  const selfPid = String(process.pid);
  return child.stdout
    .split('\n')
    .filter(Boolean)
    .some((line) => !line.trim().startsWith(selfPid) && line.includes('playwright'));
}

function parseProbeProjects(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized || normalized === 'all') return null;
  return normalized
    .split(',')
    .map((project) => project.trim())
    .filter(Boolean);
}

function stopExistingDevServer() {
  if (process.env.OPENREAD_E2E_REUSE_SERVER === 'true') return;

  const result = spawnSync('lsof', ['-tiTCP:3000', '-sTCP:LISTEN'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const pids = result.stdout
    .split('\n')
    .map((pid) => pid.trim())
    .filter(Boolean);
  if (pids.length === 0) return;

  console.log(`Stopping existing dev server on :3000 before AI probes: ${pids.join(', ')}`);
  spawnSync('kill', pids, { stdio: 'ignore' });
  const stillListening = spawnSync('lsof', ['-tiTCP:3000', '-sTCP:LISTEN'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
    .stdout.split('\n')
    .map((pid) => pid.trim())
    .filter(Boolean);
  if (stillListening.length > 0) {
    spawnSync('kill', ['-9', ...stillListening], { stdio: 'ignore' });
  }
}

function probeProjectArgs() {
  if (!probeProjects) return [];
  return probeProjects.flatMap((project) => [`--project=${project}`]);
}

function syncValidationCheckpoint(summary) {
  if (!activityId || !attemptId || !notionPageId) return null;
  try {
    execFileSync(
      'node',
      [
        'scripts/activity/notion-sync.mjs',
        '--activity',
        activityId,
        '--attempt',
        attemptId,
        '--write',
        '--summary',
        summary,
      ],
      { encoding: 'utf8', stdio: 'pipe' },
    );
    return { result: 'passed' };
  } catch (error) {
    return { result: 'failed', error: error.message ?? String(error) };
  }
}

function loadProgress() {
  if (!existsSync(progressPath)) {
    return { schemaVersion: 1, batch, startedAt: new Date().toISOString(), probes: {} };
  }

  const existing = JSON.parse(readFileSync(progressPath, 'utf8'));
  if (existing.batch !== batch) {
    return { schemaVersion: 1, batch, startedAt: new Date().toISOString(), probes: {} };
  }
  return existing;
}

function writeProgress(value) {
  writeFileSync(progressPath, JSON.stringify(value, null, 2));
}

function copyProbeScreenshots({ probe, probeOutputDir }) {
  const stage8Dir = process.env.OPENREAD_STAGE8_DIR;
  if (!stage8Dir || !existsSync(probeOutputDir)) return [];

  const evidenceDir = resolve(stage8Dir, 'playwright-evidence', safeName(probe.id));
  mkdirSync(evidenceDir, { recursive: true });

  return findPngFiles(probeOutputDir).map((sourcePath, index) => {
    const filename = `${String(index + 1).padStart(3, '0')}-${safeName(relative(probeOutputDir, sourcePath))}`;
    const evidencePath = resolve(evidenceDir, filename);
    copyFileSync(sourcePath, evidencePath);
    return { probeId: probe.id, sourcePath, evidencePath };
  });
}

function uploadProbeScreenshots({ probe, screenshots }) {
  if (!activityId || !attemptId || !notionPageId || screenshots.length === 0) return null;

  const files = screenshots.map((screenshot) => screenshot.evidencePath);
  const captions = screenshots
    .map(
      (screenshot) =>
        `${activityId} ${attemptId} stage-8-validation playwright-probe ${probe.id} ${basename(screenshot.evidencePath)}`,
    )
    .join('|');

  try {
    const output = execFileSync(
      'node',
      [
        'scripts/activity/notion-upload-file.mjs',
        '--activity',
        activityId,
        '--attempt',
        attemptId,
        '--files',
        files.join(','),
        '--page',
        notionPageId,
        '--layout',
        files.length > 1 ? 'columns' : 'single',
        '--section',
        'Validation Results',
        '--heading',
        `Playwright Probe Screenshots - ${probe.id}`,
        '--caption',
        captions,
      ],
      { encoding: 'utf8', stdio: 'pipe' },
    );
    const parsed = JSON.parse(output.slice(output.indexOf('{')));
    return {
      result: parsed.result,
      attachedBlockId: parsed.attachedBlockId ?? null,
      attachedSectionBlockId: parsed.attachedSectionBlockId ?? null,
      files: parsed.files?.length ?? files.length,
    };
  } catch (error) {
    return { result: 'failed', error: error.message ?? String(error) };
  }
}

function findPngFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = resolve(dir, entry.name);
    if (entry.isDirectory()) return findPngFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.png') ? [entryPath] : [];
  });
}

function safeName(value) {
  return String(value)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .slice(-180);
}
