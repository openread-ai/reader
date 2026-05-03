#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';
import { ensureDir, getActivityConfig, parseArgs, resolveProjects, writeJson } from './common.mjs';

const args = parseArgs(process.argv.slice(2));
const config = getActivityConfig(process.argv.slice(2));
const startedAtMs = Date.now();
const startedAt = new Date(startedAtMs).toISOString();
const appRoot = process.cwd();
const projects = resolveProjects(config.platforms);
const approvedLocal = args.approvedLocal ?? process.env.OPENREAD_APPROVED_LOCAL_SCREENSHOT;
const approvedFigma = args.approvedFigma ?? process.env.OPENREAD_APPROVED_FIGMA_URL;
const approvedNotion = args.approvedNotion ?? process.env.OPENREAD_APPROVED_NOTION_URL;
const captureDir = resolve(config.stage8Dir, 'implementation-capture');
const playwrightEvidenceDir = resolve(config.stage8Dir, 'playwright-evidence');
const currentAttemptTestPlan = readJson(
  resolve(config.attemptDir, 'test-plan/test-plan-report.json'),
);
const testPlan = currentAttemptTestPlan ?? latestApprovedActivityTestPlan();
const testPlanSource = currentAttemptTestPlan
  ? 'current-attempt'
  : testPlan
    ? 'activity-latest-approved'
    : null;
const testCommands = Array.isArray(testPlan?.commands) ? testPlan.commands : [];
const testApproval = testPlan?.testApprovalStatus;

ensureDir(config.stage8Dir);
ensureDir(captureDir);
ensureDir(playwrightEvidenceDir);

const validationRun = {
  schemaVersion: 1,
  stage: 'stage-8-validation',
  result: 'running',
  activityId: config.activityId,
  activityUuid: config.activityUuid,
  attemptId: config.attemptId,
  route: config.route,
  selector: config.selector,
  platforms: config.platforms,
  approvedTestScope: testPlan
    ? {
        approval: testApproval ?? null,
        unitTests: testPlan.unitTests ?? [],
        integrationTests: testPlan.integrationTests ?? [],
        e2eTests: testPlan.e2eTests ?? [],
        source: testPlanSource,
        sourceAttemptId: testPlan.attemptId ?? null,
        commands: testCommands,
        minimalTestPolicy: testPlan.minimalTestPolicy ?? null,
        leakCoverage: testPlan.leakCoverage ?? [],
        testPriorities: testPlan.testPriorities ?? [],
        testNonGoals: testPlan.testNonGoals ?? [],
      }
    : null,
  approvedSources: {
    local: approvedLocal ?? null,
    figma: approvedFigma ?? null,
    notion: approvedNotion ?? null,
  },
  artifactDir: config.stage8Dir,
  validationSequence: [
    'Run approved Playwright end-to-end validation commands first.',
    'Capture Playwright screenshots as validation evidence while the probes run.',
    'Run implementation capture and approved-source comparison only after Playwright validation completes.',
  ],
  startedAt,
};
writeJson(resolve(config.stage8Dir, 'validation-run.json'), validationRun);

const testRuns = runApprovedTestCommands();
const playwrightEvidence = collectPlaywrightEvidence();
const dirtyAfterTests = gitDirty();

const captureArgs = ['exec', 'playwright', 'test', 'e2e/tests/activity/current-capture.spec.ts'];
for (const { project } of projects) captureArgs.push(`--project=${project}`);

const captureResult = spawnSync('pnpm', captureArgs, {
  cwd: appRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    OPENREAD_ACTIVITY_ID: config.activityId,
    OPENREAD_ACTIVITY_ATTEMPT: config.attemptId,
    OPENREAD_ACTIVITY_ROUTE: config.route,
    OPENREAD_ACTIVITY_SELECTOR: config.selector,
    OPENREAD_ACTIVITY_ARTIFACT_DIR: captureDir,
  },
});

const validations = projects.map(({ platform, project }) => validateProject({ platform, project }));
const hasUnapprovedTests = testPlan && !['approved', 'not-needed'].includes(testApproval);
const hasCommandFailures = testRuns.some((run) => run.result === 'failed');
const hasValidationMutation = dirtyAfterTests;
const hasFailures =
  hasUnapprovedTests ||
  hasCommandFailures ||
  hasValidationMutation ||
  captureResult.status !== 0 ||
  validations.some((validation) => validation.result === 'failed');
const hasPending = validations.some((validation) => validation.result === 'pending');
const result = hasFailures ? 'failed' : hasPending ? 'partial' : 'passed';

const finishedAt = new Date().toISOString();
const durationMs = Date.now() - startedAtMs;
const verdictInput = buildVerdictInput({
  result,
  testRuns,
  playwrightEvidence,
  validations,
  hasUnapprovedTests,
  hasValidationMutation,
  captureExitCode: captureResult.status,
});

const report = {
  ...validationRun,
  result,
  definitiveValidation: ['passed', 'failed'].includes(result),
  verdictInput,
  captureExitCode: captureResult.status,
  testRuns,
  playwrightEvidence,
  validationDidMutateWorktree: hasValidationMutation,
  validations,
  nextAction:
    result === 'passed'
      ? 'Record Validation Verdict and proceed to Final Quality Gate.'
      : result === 'partial'
        ? 'Resume validation; do not record Validation Verdict until validation is definitive.'
        : 'Record failed Validation Verdict, run Revision Assessment, and retry only the scoped issue.',
  finishedAt,
  durationMs,
  stageTiming: {
    startedAt,
    finishedAt,
    durationMs,
  },
};

writeJson(resolve(config.stage8Dir, 'validation-report.json'), report);
console.log(JSON.stringify(report, null, 2));
process.exit(hasFailures ? 1 : 0);

function latestApprovedActivityTestPlan() {
  if (!existsSync(config.activityDir)) return null;

  return (
    readdirSync(config.activityDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) =>
        readJson(resolve(config.activityDir, entry.name, 'test-plan/test-plan-report.json')),
      )
      .filter((plan) => plan?.testApprovalStatus === 'approved')
      .sort((a, b) => timestampMs(b) - timestampMs(a))[0] ?? null
  );
}

function timestampMs(report) {
  const value = report?.finishedAt ?? report?.createdAt ?? report?.startedAt;
  const ms = Date.parse(value ?? '');
  return Number.isFinite(ms) ? ms : 0;
}

function runApprovedTestCommands() {
  if (!testPlan || testApproval === 'not-needed') return [];
  if (testApproval !== 'approved') {
    return [
      {
        command: '(approved Test stage required)',
        result: 'failed',
        reason: `Test scope approval is ${testApproval ?? 'missing'}`,
      },
    ];
  }
  if (testCommands.length === 0) {
    return [
      {
        command: '(no approved test commands)',
        result: 'failed',
        reason: `Approved Test stage from ${testPlanSource ?? 'unknown'} has no validation commands.`,
      },
    ];
  }

  return testCommands.map((command, index) => {
    const started = Date.now();
    const child = spawnSync(command, {
      cwd: appRoot,
      shell: true,
      encoding: 'utf8',
      stdio: 'pipe',
      maxBuffer: 20 * 1024 * 1024,
      env: {
        ...process.env,
        OPENREAD_ACTIVITY_ID: config.activityId,
        OPENREAD_ACTIVITY_UUID: config.activityUuid ?? '',
        OPENREAD_ACTIVITY_ATTEMPT: config.attemptId,
        OPENREAD_STAGE8_DIR: config.stage8Dir,
        OPENREAD_NOTION_ACTIVITY_PAGE_ID: notionPageIdFromUrl(approvedNotion),
      },
    });
    const stdoutPath = resolve(config.stage8Dir, `test-command-${index + 1}-stdout.log`);
    const stderrPath = resolve(config.stage8Dir, `test-command-${index + 1}-stderr.log`);
    writeFileSync(stdoutPath, child.stdout ?? '');
    writeFileSync(stderrPath, child.stderr ?? '');
    const finishedAt = new Date().toISOString();
    return {
      command,
      result: child.status === 0 ? 'passed' : 'failed',
      exitCode: child.status ?? 1,
      stdoutPath,
      stderrPath,
      startedAt: new Date(started).toISOString(),
      finishedAt,
      durationMs: Date.now() - started,
    };
  });
}

function buildVerdictInput({
  result,
  testRuns,
  playwrightEvidence,
  validations,
  hasUnapprovedTests,
  hasValidationMutation,
  captureExitCode,
}) {
  const failures = [
    ...(hasUnapprovedTests
      ? [{ type: 'test-approval', reason: 'Test scope is not approved.' }]
      : []),
    ...testRuns
      .filter((run) => run.result === 'failed')
      .map((run) => ({
        type: 'test-command',
        command: run.command,
        exitCode: run.exitCode,
        evidence: [run.stdoutPath, run.stderrPath].filter(Boolean),
      })),
    ...(hasValidationMutation
      ? [{ type: 'validation-mutated-worktree', reason: 'Validation mutated the worktree.' }]
      : []),
    ...(captureExitCode !== 0
      ? [{ type: 'implementation-capture', reason: `Capture exited ${captureExitCode}.` }]
      : []),
    ...validations
      .filter((validation) => validation.result === 'failed')
      .map((validation) => ({
        type: 'validation-check',
        platform: validation.platform,
        project: validation.project,
        reason: validation.reason,
        evidence: [validation.implementationPath, validation.comparisonPath].filter(Boolean),
      })),
  ];
  const missingEvidence = [];
  const probeCommandRequested = testRuns.some((run) =>
    String(run.command ?? '').includes('test:e2e:probes'),
  );
  if (probeCommandRequested && playwrightEvidence.screenshotCount === 0) {
    missingEvidence.push('Playwright probe screenshots');
  }

  return {
    expected: {
      type: approvedLocal ? 'design' : testRuns.length > 0 ? 'test-plan' : 'capture-only',
      approvedSources: validationRun.approvedSources,
      approvedTestScope: validationRun.approvedTestScope,
    },
    actual: {
      testRunCount: testRuns.length,
      screenshotCount: playwrightEvidence.screenshotCount,
      validationCount: validations.length,
      failures,
      missingEvidence,
    },
    recommendedVerdict:
      result === 'passed' && failures.length === 0 && missingEvidence.length === 0
        ? 'approved'
        : 'needs-revision',
    reason:
      result === 'passed'
        ? 'Validation evidence matches approved expectation.'
        : (failures[0]?.reason ??
          failures[0]?.command ??
          missingEvidence[0] ??
          'Validation failed.'),
  };
}

function notionPageIdFromUrl(value) {
  const compact = String(value ?? '').match(/([0-9a-fA-F]{32})(?:[?#/].*)?$/)?.[1];
  if (!compact) return '';
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

function collectPlaywrightEvidence() {
  const progressEvidence = collectAiProbeProgressEvidence();
  if (progressEvidence) return progressEvidence;

  const sourceDir = resolve(appRoot, 'test-results/ai-probes/artifacts');
  const sourceScreenshots = existsSync(sourceDir) ? findPngFiles(sourceDir) : [];
  const screenshots = sourceScreenshots.map((sourcePath, index) => {
    const relativePath = relative(sourceDir, sourcePath);
    const filename = `${String(index + 1).padStart(3, '0')}-${sanitizeFilename(relativePath)}`;
    const evidencePath = resolve(playwrightEvidenceDir, filename);
    copyFileSync(sourcePath, evidencePath);
    return { sourcePath, evidencePath };
  });

  return {
    runner: 'Playwright',
    screenshotPolicy: 'on',
    source: 'ai-probe-artifact-directory',
    sourceDir,
    artifactDir: playwrightEvidenceDir,
    screenshots,
    screenshotCount: screenshots.length,
  };
}

function collectAiProbeProgressEvidence() {
  const progressPath = resolve(
    appRoot,
    'test-results/ai-probes',
    `progress-${sanitizeFilename(config.attemptId)}.json`,
  );
  const progress = readJson(progressPath);
  if (!progress?.probes || typeof progress.probes !== 'object') return null;

  const screenshots = Object.values(progress.probes)
    .flatMap((probe) => (Array.isArray(probe?.screenshots) ? probe.screenshots : []))
    .filter((screenshot) => screenshot?.evidencePath && existsSync(screenshot.evidencePath))
    .map((screenshot) => ({
      probeId: screenshot.probeId ?? null,
      sourcePath: screenshot.sourcePath ?? null,
      evidencePath: screenshot.evidencePath,
    }));

  return {
    runner: 'Playwright',
    screenshotPolicy: 'on',
    source: 'ai-probe-progress',
    sourceProgressPath: progressPath,
    artifactDir: playwrightEvidenceDir,
    screenshots,
    screenshotCount: screenshots.length,
  };
}

function findPngFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = resolve(dir, entry.name);
    if (entry.isDirectory()) return findPngFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.png') ? [entryPath] : [];
  });
}

function sanitizeFilename(value) {
  return String(value)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .slice(-180);
}

function gitDirty() {
  const child = spawnSync('git', ['status', '--short'], {
    cwd: appRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  return child.status === 0 && child.stdout.trim().length > 0;
}

function readJson(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function validateProject({ platform, project }) {
  const implementationPath = resolve(captureDir, `${project}.png`);
  const comparisonPath = resolve(config.stage8Dir, `${project}-comparison.html`);

  if (!existsSync(implementationPath)) {
    return {
      platform,
      project,
      result: 'failed',
      reason: 'implementation capture missing',
      implementationPath,
    };
  }

  if (!approvedLocal) {
    return {
      platform,
      project,
      result: 'passed',
      reason:
        'implementation capture recorded; no local approved screenshot configured, so automated visual comparison was skipped',
      implementationPath,
      approvedSources: { figma: approvedFigma ?? null, notion: approvedNotion ?? null },
    };
  }

  if (!existsSync(approvedLocal)) {
    return {
      platform,
      project,
      result: 'failed',
      reason: 'local approved screenshot path does not exist',
      approvedLocal,
      implementationPath,
    };
  }

  writeFileSync(
    comparisonPath,
    renderComparisonHtml({
      activityId: config.activityId,
      platform,
      project,
      approvedLocal,
      implementationPath,
      approvedFigma,
      approvedNotion,
    }),
  );

  return {
    platform,
    project,
    result: 'pending',
    reason: 'comparison artifact created; human or agent visual verdict required',
    approvedLocal,
    implementationPath,
    comparisonPath,
    approvedSources: { figma: approvedFigma ?? null, notion: approvedNotion ?? null },
  };
}

function renderComparisonHtml({
  activityId,
  platform,
  project,
  approvedLocal,
  implementationPath,
  approvedFigma,
  approvedNotion,
}) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(activityId)} ${escapeHtml(project)} validation</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 24px; background: #111827; color: #f9fafb; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
    .card { background: #1f2937; border: 1px solid #374151; border-radius: 12px; padding: 16px; }
    img { width: 100%; height: auto; border-radius: 8px; background: white; }
    code, a { color: #93c5fd; }
  </style>
</head>
<body>
  <h1>${escapeHtml(activityId)} validation</h1>
  <p>Platform: <code>${escapeHtml(platform)}</code> Project: <code>${escapeHtml(project)}</code></p>
  <p>Figma: ${approvedFigma ? link(approvedFigma) : 'not provided'}</p>
  <p>Notion: ${approvedNotion ? link(approvedNotion) : 'not provided'}</p>
  <div class="grid">
    <section class="card">
      <h2>Approved (${escapeHtml(basename(approvedLocal))})</h2>
      <img src="${imageDataUri(approvedLocal)}" />
    </section>
    <section class="card">
      <h2>Implementation (${escapeHtml(basename(implementationPath))})</h2>
      <img src="${imageDataUri(implementationPath)}" />
    </section>
  </div>
</body>
</html>`;
}

function imageDataUri(path) {
  return `data:image/png;base64,${readFileSync(path).toString('base64')}`;
}

function link(url) {
  return `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (char) => {
    const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
    return entities[char];
  });
}
