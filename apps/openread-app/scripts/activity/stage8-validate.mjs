#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
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

ensureDir(config.stage8Dir);
ensureDir(captureDir);

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
  approvedSources: {
    local: approvedLocal ?? null,
    figma: approvedFigma ?? null,
    notion: approvedNotion ?? null,
  },
  artifactDir: config.stage8Dir,
  startedAt,
};
writeJson(resolve(config.stage8Dir, 'validation-run.json'), validationRun);

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
const hasFailures =
  captureResult.status !== 0 || validations.some((validation) => validation.result === 'failed');
const hasPending = validations.some((validation) => validation.result === 'pending');
const result = hasFailures ? 'failed' : hasPending ? 'partial' : 'passed';

const report = {
  ...validationRun,
  result,
  captureExitCode: captureResult.status,
  validations,
  nextAction:
    result === 'passed'
      ? 'Review validation artifacts and proceed to simplify/security review.'
      : result === 'partial'
        ? 'Provide missing approved design sources or perform human review of comparison artifacts.'
        : 'Fix implementation capture or approved design mismatch, then retry Stage 8.',
  finishedAt: new Date().toISOString(),
  durationMs: Date.now() - startedAtMs,
};

writeJson(resolve(config.stage8Dir, 'validation-report.json'), report);
console.log(JSON.stringify(report, null, 2));
process.exit(hasFailures ? 1 : 0);

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
      result: 'pending',
      reason: 'local approved screenshot is required for automated comparison artifact generation',
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
