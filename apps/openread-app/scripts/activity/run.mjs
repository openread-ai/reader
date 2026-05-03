#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import {
  ensureDir,
  formatActivityTimestamp,
  getActivityConfig,
  loadActivityEnv,
  parseArgs,
  readJsonIfExists,
  writeJson,
} from './common.mjs';

loadActivityEnv();

const argv = process.argv.slice(2);
const args = parseArgs(argv);
if (args.help || args.h) {
  printHelp();
  process.exit(0);
}

const config = getActivityConfig(argv);
const startedAtMs = Date.now();
const startedAt = new Date(startedAtMs).toISOString();
const dryRun = String(args.dryRun ?? 'false') === 'true';
const artifactDir = resolve(config.attemptDir, 'activity-run');
const notionState = await loadNotionState();

ensureDir(artifactDir);

const state = loadState();
const decision = decideNext(state, notionState);
liveLog(
  decision.command
    ? `selected ${decision.nextStage}: ${decision.reason}`
    : `stopping: ${decision.reason}`,
);
const execution = decision.command ? runDecision(decision) : null;
const result =
  execution?.exitCode === undefined || execution.exitCode === 0 ? decision.result : 'failed';
const report = {
  schemaVersion: 1,
  stage: 'activity-run',
  result,
  mode: dryRun ? 'dry-run' : 'execute',
  activityId: config.activityId,
  activityUuid: config.activityUuid,
  attemptId: config.attemptId,
  artifactDir,
  notion: notionState,
  decision,
  lifecycleStage: decision.nextStage ?? null,
  execution,
  startedAt,
  finishedAt: new Date().toISOString(),
  durationMs: Date.now() - startedAtMs,
  createdAt: startedAt,
};

writeJson(resolve(artifactDir, 'activity-run-report.json'), report);
console.log(JSON.stringify(report, null, 2));
process.exit(result === 'failed' ? 1 : 0);

function loadState() {
  return {
    activity: readJsonIfExists(resolve(config.activityDir, 'activity.json')),
    capturePlan: readJsonIfExists(config.capturePlanPath),
    testPlan: latestAttemptReport('test-plan/test-plan-report.json'),
    testApproval: latestAttemptReport('test-approval/test-approval-report.json'),
    bootstrap: latestAttemptReport('bootstrap/bootstrap-report.json'),
    stage3:
      latestAttemptReport('stage-3-platform-test/platform-test-report.json') ??
      latestAttemptReport('stage-3-readiness/readiness-report.json'),
    stage4: latestAttemptReport('stage-4-current-capture/current-capture-report.json'),
    approval: latestAttemptReport('approval/approval-report.json'),
    implementation: latestAttemptReport('implementation/implementation-report.json'),
    implementationAgent: latestAttemptReport(
      'implementation-agent/implementation-agent-report.json',
    ),
    stage8: latestAttemptReport('stage-8-validation/validation-report.json'),
    stage8Checkpoint: latestAttemptReport('stage-8-validation/validation-checkpoint-report.json'),
    validationVerdict: latestAttemptReport('stage-8-validation/validation-verdict.json'),
    revisionAssessment: latestAttemptReport('revision-assessment/revision-assessment-report.json'),
  };
}

function latestAttemptReport(relativePath) {
  const current = readJsonIfExists(resolve(config.attemptDir, relativePath));
  if (current) return current;
  if (!existsSync(config.activityDir)) return null;
  return readdirSync(config.activityDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readJsonIfExists(resolve(config.activityDir, entry.name, relativePath)))
    .filter(Boolean)
    .sort(
      (a, b) =>
        Date.parse(a.finishedAt ?? a.createdAt ?? '') -
        Date.parse(b.finishedAt ?? b.createdAt ?? ''),
    )
    .at(-1);
}

async function loadNotionState() {
  const notionToken = process.env.NOTION_TOKEN ?? process.env.NOTION_API_KEY;
  const notionConfig =
    readJsonIfExists(resolve(config.artifactRoot, 'notion-activity-log.json')) ??
    readJsonIfExists(
      resolve(homedir(), '.openread-dev/activity-artifacts/notion-activity-log.json'),
    );
  const databaseId = args.notionDatabase ?? notionConfig?.activityLogDatabaseId;
  if (!notionToken || !databaseId) return { mode: 'unavailable' };

  const page = await notionRequest({
    notionToken,
    path: `/v1/databases/${normalizeNotionId(databaseId)}/query`,
    method: 'POST',
    body: {
      filter: { property: 'Activity ID', rich_text: { equals: config.activityId } },
      page_size: 1,
    },
  });
  const result = page.results?.[0] ?? null;
  if (!result) return { mode: 'available', result: 'not-found' };

  return {
    mode: 'available',
    result: 'found',
    pageId: result.id,
    url: result.url,
    status: selectName(result.properties?.Status),
    currentStage: richTextValue(result.properties?.['Current Stage']),
    approvalStatus: selectName(result.properties?.['Approval Status']),
    latestAttempt: richTextValue(result.properties?.['Latest Attempt']),
    nextAction: richTextValue(result.properties?.['Next Action']),
  };
}

function decideNext(state, notion) {
  if (!state.activity) {
    return stop('failed', 'Activity metadata is missing. Run activity:init first.');
  }

  if (
    notion?.approvalStatus &&
    !['Not Needed', 'Approved'].includes(notion.approvalStatus) &&
    !canContinueValidation(notion) &&
    !canResumeFailedStage(notion) &&
    !hasExplicitApprovalOverride()
  ) {
    return stop(
      notion.approvalStatus === 'Pending' ? 'partial' : 'failed',
      `Notion approval status is ${notion.approvalStatus}. Do not proceed until approval changes.`,
    );
  }

  if (!state.testPlan) {
    if (!args.intent) {
      return stop('partial', 'Test plan is missing. Provide --intent to create it.');
    }
    return command(
      'test-case-planning',
      'Create Test stage scope from intent before scoping/capture.',
      [
        'scripts/activity/test-plan-marker.mjs',
        ...forwardArgs(),
        '--scope',
        args.intent,
        '--approval',
        'pending',
      ],
    );
  }

  if (!testScopeApproved(state)) {
    const notionTestApproval = notionMarkerApproval(notion, 'Test');
    if (notionTestApproval) {
      return command('test-approval', 'Record Notion Test approval locally.', [
        'scripts/activity/test-approval-marker.mjs',
        ...forwardArgs(),
        '--approval',
        notionTestApproval,
        '--source',
        'notion',
        '--reason',
        `Notion Activity Log approval recorded for Test stage as ${notion.approvalStatus}.`,
      ]);
    }
    const testApproval = args.testApproval ?? args.approval;
    if (testApproval) {
      return command('test-approval', 'Record Test stage approval.', [
        'scripts/activity/test-approval-marker.mjs',
        ...forwardArgs(),
        '--approval',
        testApproval,
      ]);
    }
    return stop(
      'partial',
      'Test stage is pending approval. Approve unit/integration/e2e scope before scoping/capture.',
    );
  }

  if (!state.capturePlan) {
    if (!args.intent) {
      return stop('partial', 'Capture plan is missing. Provide --intent to create it.');
    }
    return command(
      'capture-planning',
      'Create capture plan from activity intent and approved Test scope.',
      ['scripts/activity/plan-capture.mjs', ...forwardArgs()],
    );
  }

  if (!passed(state.bootstrap)) {
    if (state.bootstrap?.result === 'failed') {
      return stop('failed', 'Bootstrap failed. Fix bootstrap output before resuming.');
    }
    return command('activity-bootstrap', 'Run dependency/tooling bootstrap.', [
      'scripts/activity/bootstrap.mjs',
      ...forwardArgs(),
    ]);
  }

  if (!acceptable(state.stage3)) {
    if (state.stage3?.result === 'failed') {
      return stop('failed', 'Stage 3 platform test failed. Fix platform readiness first.');
    }
    return command('stage-3-platform-test', 'Run platform test/readiness lanes.', [
      'scripts/activity/stage3-platform-test.mjs',
      ...forwardArgs(),
    ]);
  }

  if (!acceptable(state.stage4)) {
    if (state.stage4?.result === 'failed' && !canResumeFailedStage(notion)) {
      return stop('failed', 'Stage 4 current capture failed. Fix capture lane first.');
    }
    return command('stage-4-current-capture', 'Run current-state capture.', [
      'scripts/activity/stage4-current-capture.mjs',
      ...forwardArgs(),
    ]);
  }

  if (!state.approval) {
    const notionDesignApproval = notionMarkerApproval(notion);
    if (notionDesignApproval) {
      return command('approval', 'Record Notion approval locally before implementation.', [
        'scripts/activity/approval-marker.mjs',
        ...forwardArgs(),
        '--approval',
        notionDesignApproval,
        '--source',
        'notion',
        ...(notion.url ? ['--notion-url', notion.url] : []),
      ]);
    }
    if (args.approval) {
      return command('approval', 'Record explicit approval decision.', [
        'scripts/activity/approval-marker.mjs',
        ...forwardArgs(),
      ]);
    }
    return stop('partial', 'Current capture complete. Stop for approval before implementation.');
  }

  if (!approved(state.approval)) {
    return stop('failed', 'Approval is rejected or needs revision. Do not implement yet.');
  }

  const currentStage8 = currentValidationForImplementation(state);
  const currentVerdict = currentVerdictForValidation(state, currentStage8);
  const currentAssessment = currentAssessmentForVerdict(state, currentVerdict);

  if (currentVerdict && !verdictApproved(currentVerdict)) {
    if (!currentAssessment) {
      return command('revision-assessment', 'Classify definitive failed validation before retry.', [
        'scripts/activity/revision-assessment.mjs',
        ...forwardArgs(),
      ]);
    }

    if (currentAssessment.routeTo === 'blocked') {
      return stop('failed', currentAssessment.reason ?? 'Revision assessment blocked automation.');
    }

    if (
      currentAssessment.routeTo === 'readiness' &&
      !reportAfter(state.stage3, currentAssessment)
    ) {
      return command('stage-3-platform-test', 'Rerun readiness from revision assessment.', [
        'scripts/activity/stage3-platform-test.mjs',
        ...forwardArgs(),
      ]);
    }

    if (
      currentAssessment.routeTo === 'readiness' &&
      reportAfter(state.stage3, currentAssessment) &&
      !reportAfter(state.stage8, state.stage3)
    ) {
      return command('stage-8-validation', 'Rerun validation after readiness repair.', [
        'scripts/activity/stage8-validate.mjs',
        ...forwardArgs(),
        ...approvedSourceArgs(state.approval),
      ]);
    }

    if (
      currentAssessment.routeTo === 'validation' &&
      !reportAfter(state.stage8, currentAssessment)
    ) {
      return command('stage-8-validation', 'Resume validation from revision assessment.', [
        'scripts/activity/stage8-validate.mjs',
        ...forwardArgs(),
        ...approvedSourceArgs(state.approval),
      ]);
    }

    if (
      currentAssessment.routeTo === 'implementation' &&
      !reportAfter(state.implementation, currentAssessment)
    ) {
      return command('implementation', 'Restart scoped implementation from revision assessment.', [
        'scripts/activity/implementation-marker.mjs',
        ...forwardArgs(),
        '--status',
        'started',
        '--summary',
        assessmentSummary(currentAssessment),
      ]);
    }
  }

  if (!state.implementation) {
    return command('implementation', 'Mark implementation as started.', [
      'scripts/activity/implementation-marker.mjs',
      ...forwardArgs(),
      '--status',
      'started',
    ]);
  }

  if (state.implementation.implementationStatus === 'blocked') {
    return stop('failed', 'Implementation is blocked. Resolve blocker before validation.');
  }

  const currentImplementationAgent = reportAfter(state.implementationAgent, state.implementation)
    ? state.implementationAgent
    : null;

  if (state.implementation.implementationStatus !== 'completed') {
    if (currentImplementationAgent?.result === 'passed') {
      return command(
        'implementation-complete',
        'Mark implementation as completed after agent work.',
        [
          'scripts/activity/implementation-marker.mjs',
          ...forwardArgs(),
          '--status',
          'completed',
          '--summary',
          implementationCompletionSummary(currentImplementationAgent),
        ],
      );
    }

    if (currentImplementationAgent?.result === 'failed') {
      return stop('failed', 'Implementation agent failed or blocked. Resolve before validation.');
    }

    if (args.allowMutation !== true) {
      return stop(
        'partial',
        'Implementation has started. Resume with --allow-mutation to run the implementation agent before Stage 8 validation.',
      );
    }

    return command('implementation-agent', 'Run implementation agent loop.', [
      'scripts/activity/implementation-agent.mjs',
      ...forwardArgs(),
    ]);
  }

  if (!currentStage8 || !validationIsDefinitive(currentStage8)) {
    return command('stage-8-validation', 'Run or resume definitive implementation validation.', [
      'scripts/activity/stage8-validate.mjs',
      ...forwardArgs(),
      ...approvedSourceArgs(state.approval),
    ]);
  }

  if (!currentVerdict) {
    return command('validation-verdict', 'Record deterministic validation verdict.', [
      'scripts/activity/validation-verdict.mjs',
      ...forwardArgs(),
      '--verdict',
      currentStage8.result === 'passed' ? 'approved' : 'needs-revision',
      '--reason',
      validationVerdictReason(currentStage8),
    ]);
  }

  if (!verdictApproved(currentVerdict)) {
    return stop(
      'partial',
      'Revision assessment route completed; rerun activity runner for next routed step.',
    );
  }

  return command('notion-sync', 'Sync latest activity state to Notion or dry-run report.', [
    'scripts/activity/notion-sync.mjs',
    ...forwardArgs(),
    ...(args.write ? ['--write'] : []),
  ]);
}

async function notionRequest({ notionToken, path, method, body }) {
  const res = await fetch(`https://api.notion.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${notionToken}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion request failed: ${method} ${path} ${res.status} ${text}`);
  }

  return res.json();
}

function selectName(property) {
  return property?.select?.name ?? null;
}

function richTextValue(property) {
  return property?.rich_text?.map((part) => part.plain_text).join('') ?? '';
}

function normalizeNotionId(value) {
  return String(value).replace(/-/g, '').trim();
}

function runDecision(decision) {
  if (dryRun) return null;
  const started = Date.now();
  const stage = canonicalStageForDecision(decision.nextStage);
  liveLog(`entering ${stage}: ${decision.nextStage}`);
  const mode = args.mode === 'continuous' ? 'continuous' : 'discrete';
  const before = runChild('stage-context', [
    'scripts/activity/stage-context.mjs',
    ...forwardArgs(),
    '--stage',
    stage,
    '--mode',
    mode,
  ]);

  if (before.exitCode !== 0) {
    return { before, command: `node ${decision.command.join(' ')}`, exitCode: before.exitCode };
  }

  const child = runChild(decision.nextStage, decision.command);
  const childReport = childReportForDecision(decision, child);
  const handledFailure = handledLifecycleFailure(decision, childReport);
  liveLog(
    `${decision.nextStage} ${child.exitCode === 0 || handledFailure ? 'completed' : 'failed'} in ${formatDuration(child.durationMs)}`,
  );
  const after = runChild('notion-sync', [
    'scripts/activity/notion-sync.mjs',
    ...forwardArgs(),
    '--write',
    '--summary',
    stageSummary(decision.nextStage, child.exitCode === 0),
  ]);
  const artifactUpload =
    maybeUploadCurrentCaptureArtifacts(decision, child, after) ??
    maybeUploadValidationArtifacts(decision, child, after);
  const childExitCode = handledFailure ? 0 : child.exitCode;

  return {
    command: `node ${decision.command.join(' ')}`,
    exitCode:
      childExitCode === 0 &&
      after.exitCode === 0 &&
      (!artifactUpload || artifactUpload.exitCode === 0)
        ? 0
        : childExitCode || after.exitCode || artifactUpload?.exitCode,
    before,
    child,
    after,
    artifactUpload,
    childReport,
    handledFailure,
    durationMs: Date.now() - started,
  };
}

function childReportForDecision(decision, child) {
  if (decision.nextStage === 'stage-8-validation') {
    return (
      readJsonIfExists(resolve(config.stage8Dir, 'validation-report.json')) ??
      extractJsonSummary(child.stdoutPreview)
    );
  }
  return extractJsonSummary(child.stdoutPreview);
}

function handledLifecycleFailure(decision, childReport) {
  return (
    decision.nextStage === 'stage-8-validation' &&
    childReport?.stage === 'stage-8-validation' &&
    childReport?.definitiveValidation === true &&
    ['passed', 'failed'].includes(childReport?.result)
  );
}

function stageSummary(stage, passed) {
  const status = passed ? '✅' : '❌';
  const summaries = {
    'capture-planning': passed
      ? '✅ Scoping — capture plan created.'
      : '❌ Scoping — capture planning failed.',
    'activity-bootstrap': passed
      ? '✅ Setup — dependencies, vendors, and browsers are ready.'
      : '❌ Setup — bootstrap failed.',
    'stage-3-platform-test': passed
      ? '✅ Readiness — platform readiness checks passed.'
      : '❌ Readiness — platform readiness checks failed.',
    'stage-4-current-capture': passed
      ? '✅ Current Capture — reader screenshots captured and synced for review.'
      : '❌ Current Capture — screenshot capture failed.',
    approval: passed
      ? '✅ Design Approval Gate — approval recorded.'
      : '❌ Design Approval Gate — approval failed.',
    implementation: passed
      ? '✅ Implementation — implementation status updated.'
      : '❌ Implementation — implementation marker failed.',
    'implementation-agent': passed
      ? '✅ Implementation — implementation agent completed.'
      : '❌ Implementation — implementation agent failed.',
    'implementation-complete': passed
      ? '✅ Implementation — implementation completed.'
      : '❌ Implementation — completion marker failed.',
    'stage-8-validation': passed
      ? '✅ Validation — validation checks completed.'
      : '❌ Validation — validation checks failed.',
    'validation-verdict': passed
      ? '✅ Validation Verdict — verdict recorded.'
      : '❌ Validation Verdict — verdict failed.',
    'revision-assessment': passed
      ? '✅ Revision Assessment — validation issue routed.'
      : '❌ Revision Assessment — manual review required.',
  };
  return summaries[stage] ?? `${status} ${stage} — ${passed ? 'completed' : 'failed'}.`;
}

function maybeUploadValidationArtifacts(decision, child, after) {
  if (decision.nextStage !== 'stage-8-validation' || child.exitCode !== 0 || after.exitCode !== 0) {
    return null;
  }

  const notionPageId = extractJsonSummary(
    readFileSync(after.stdoutPath, 'utf8'),
  )?.notionActivityPageId;
  if (!notionPageId) return null;

  const playwrightEvidenceDir = resolve(config.stage8Dir, 'playwright-evidence');
  const captureDir = resolve(config.stage8Dir, 'implementation-capture');
  const playwrightPngFiles = pngFilesInDir(playwrightEvidenceDir);
  const capturePngFiles = pngFilesInDir(captureDir);
  const pngFiles = playwrightPngFiles.length > 0 ? playwrightPngFiles : capturePngFiles;
  if (pngFiles.length === 0) return null;

  const sourceLabel = playwrightPngFiles.length > 0 ? 'playwright-probe' : 'implementation-capture';
  const heading =
    playwrightPngFiles.length > 0
      ? 'Playwright Probe Screenshots'
      : 'Validation Capture Screenshots';

  return runChild('notion-upload-validation-capture', [
    'scripts/activity/notion-upload-file.mjs',
    ...forwardArgs(),
    '--files',
    pngFiles.join(','),
    '--page',
    notionPageId,
    '--layout',
    'columns',
    '--section',
    'Validation Results',
    '--heading',
    heading,
    '--caption',
    pngFiles
      .map((file) => {
        const platform = file.split('/').at(-1)?.replace('.png', '') ?? 'screenshot';
        return `${config.activityId} ${config.attemptId} stage-8-validation ${sourceLabel} ${platform}`;
      })
      .join('|'),
  ]);
}

function pngFilesInDir(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = resolve(dir, entry.name);
    if (entry.isDirectory()) return pngFilesInDir(entryPath);
    return entry.isFile() && entry.name.endsWith('.png') ? [entryPath] : [];
  });
}

function maybeUploadCurrentCaptureArtifacts(decision, child, after) {
  if (
    decision.nextStage !== 'stage-4-current-capture' ||
    child.exitCode !== 0 ||
    after.exitCode !== 0
  ) {
    return null;
  }

  const notionPageId = extractJsonSummary(
    readFileSync(after.stdoutPath, 'utf8'),
  )?.notionActivityPageId;
  if (!notionPageId) return null;

  const pngFiles = existsSync(config.stage4Dir)
    ? readdirSync(config.stage4Dir)
        .filter((name) => name.endsWith('.png'))
        .map((name) => resolve(config.stage4Dir, name))
    : [];
  if (pngFiles.length === 0) return null;

  return runChild('notion-upload-current-capture', [
    'scripts/activity/notion-upload-file.mjs',
    ...forwardArgs(),
    '--files',
    pngFiles.join(','),
    '--page',
    notionPageId,
    '--layout',
    'columns',
    '--section',
    'Current Capture',
    '--heading',
    'Current Capture Screenshots',
    '--caption',
    pngFiles
      .map((file) => {
        const platform = file.split('/').at(-1)?.replace('.png', '') ?? 'screenshot';
        return `${config.activityId} ${config.attemptId} stage-4-current-capture ${platform}`;
      })
      .join('|'),
  ]);
}

function runChild(label, commandArgs) {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  liveLog(`running ${label}`);
  const child = spawnSync('node', commandArgs, {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    stdio: 'pipe',
    maxBuffer: 20 * 1024 * 1024,
  });

  const stdoutPath = resolve(artifactDir, `${label}-stdout.log`);
  const stderrPath = resolve(artifactDir, `${label}-stderr.log`);
  writeFileSync(stdoutPath, redactSecrets(child.stdout));
  writeFileSync(stderrPath, redactSecrets(child.stderr));

  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - started;
  liveLog(`${label} finished with exit ${child.status ?? 1} in ${formatDuration(durationMs)}`);

  return {
    command: `node ${commandArgs.join(' ')}`,
    exitCode: child.status,
    stdoutPath,
    stderrPath,
    stdoutPreview: preview(child.stdout),
    stderrPreview: preview(child.stderr),
    startedAt,
    finishedAt,
    durationMs,
  };
}

function liveLog(message) {
  console.error(`[${formatActivityTimestamp()}] activity-run: ${message}`);
}

function formatDuration(durationMs) {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function canonicalStageForDecision(stage) {
  const stages = {
    'capture-planning': 'scoping',
    'activity-bootstrap': 'setup',
    'stage-3-platform-test': 'readiness',
    'stage-3-readiness': 'readiness',
    'android-platform-smoke': 'readiness',
    'stage-4-current-capture': 'current-capture',
    'stage-4-browser-capture': 'current-capture',
    'stage-4-native-capture': 'current-capture',
    approval: 'design-approval-gate',
    implementation: 'implementation',
    'implementation-agent': 'implementation',
    'implementation-complete': 'implementation',
    'stage-8-validation': 'validation',
    'validation-verdict': 'validation-verdict',
    'revision-assessment': 'implementation',
    'notion-sync': 'final-sync-close',
  };
  return stages[stage] ?? stage;
}

function canResumeFailedStage(notion) {
  return (
    args.resumeFailedStage === true &&
    String(notion?.status ?? '') === 'Blocked' &&
    String(notion?.currentStage ?? '') !== 'Design Approval Gate'
  );
}

function canContinueValidation(notion) {
  return (
    String(notion?.status ?? '') === 'Validating' &&
    String(notion?.currentStage ?? '') === 'Validation'
  );
}

function hasExplicitApprovalOverride() {
  return Boolean(args.approval || args.testApproval);
}

function command(stage, reason, commandArgs) {
  return {
    result: 'passed',
    nextStage: stage,
    action: dryRun ? 'would-run' : 'run',
    reason,
    command: commandArgs,
  };
}

function stop(result, reason) {
  return {
    result,
    action: 'stop',
    reason,
    command: null,
  };
}

function forwardArgs() {
  const omitted = new Set(['dryRun', 'write']);
  const output = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      output.push(arg);
      continue;
    }

    const equalsIndex = arg.indexOf('=');
    const rawKey = equalsIndex === -1 ? arg.slice(2) : arg.slice(2, equalsIndex);
    const inlineValue = equalsIndex === -1 ? undefined : arg.slice(equalsIndex + 1);
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (!omitted.has(key)) {
      output.push(arg);
      continue;
    }

    if (inlineValue === undefined && argv[index + 1] && !argv[index + 1].startsWith('--')) {
      index += 1;
    }
  }

  return output;
}

function approvedSourceArgs(approval) {
  const values = [];
  if (approval.approvedLocal) values.push('--approved-local', approval.approvedLocal);
  if (approval.figmaUrl) values.push('--approved-figma', approval.figmaUrl);
  if (approval.notionUrl) values.push('--approved-notion', approval.notionUrl);
  return values;
}

function currentValidationForImplementation(state) {
  if (state.implementation?.implementationStatus !== 'completed') return null;
  return reportAfter(state.stage8, state.implementation) ? state.stage8 : null;
}

function currentVerdictForValidation(state, validation) {
  if (!validation) return null;
  return reportAfter(state.validationVerdict, validation) ? state.validationVerdict : null;
}

function currentAssessmentForVerdict(state, verdict) {
  if (!verdict || verdictApproved(verdict)) return null;
  return reportAfter(state.revisionAssessment, verdict) ? state.revisionAssessment : null;
}

function reportAfter(report, predecessor) {
  if (!report || !predecessor) return false;
  return reportTime(report) >= reportTime(predecessor);
}

function reportTime(report) {
  const value = report?.finishedAt ?? report?.createdAt ?? report?.startedAt;
  const ms = Date.parse(value ?? '');
  return Number.isFinite(ms) ? ms : 0;
}

function validationIsDefinitive(report) {
  return ['passed', 'failed'].includes(report?.result);
}

function verdictApproved(report) {
  return report?.verdict === 'approved' || report?.result === 'passed';
}

function validationVerdictReason(report) {
  const inputReason = String(report?.verdictInput?.reason ?? '').trim();
  if (inputReason) return inputReason.slice(0, 500);
  if (report?.result === 'passed') return 'Definitive validation passed.';
  const failedRun = report?.testRuns?.find((run) => run.result === 'failed');
  if (failedRun) return `Definitive validation failed: ${failedRun.command}`.slice(0, 500);
  const failedValidation = report?.validations?.find(
    (validation) => validation.result === 'failed',
  );
  if (failedValidation)
    return `Definitive validation failed: ${failedValidation.reason}`.slice(0, 500);
  return 'Definitive validation failed.';
}

function assessmentSummary(report) {
  const probe = report?.issueScope?.probeId ? ` Probe: ${report.issueScope.probeId}.` : '';
  return `Revision assessment route: ${report?.routeTo}. ${report?.reason ?? ''}${probe}`.slice(
    0,
    900,
  );
}

function acceptable(report) {
  return report?.result === 'passed' || report?.result === 'partial';
}

function testScopeApproved(state) {
  const status = state.testApproval?.testApprovalStatus ?? state.testPlan?.testApprovalStatus;
  return ['approved', 'not-needed'].includes(status);
}

function notionMarkerApproval(notion, requiredStage = null) {
  if (!notion) return null;
  if (requiredStage && notion.currentStage !== requiredStage) return null;
  if (notion.approvalStatus === 'Approved') return 'approved';
  if (notion.approvalStatus === 'Not Needed') return 'not-needed';
  return null;
}

function implementationCompletionSummary(report) {
  const summary = String(report?.summary ?? '').trim();
  const evidence = report?.evidencePath ? ` Evidence: ${report.evidencePath}` : '';
  return `${summary || 'Implementation agent completed.'}${evidence}`.slice(0, 900);
}

function passed(report) {
  return report?.result === 'passed';
}

function approved(report) {
  return report?.approvalStatus === 'approved' || report?.approvalStatus === 'not-needed';
}

function preview(value) {
  const text = redactSecrets(value).trim();
  if (!text) return '';
  return text.length > 1_000
    ? `${text.slice(0, 500)}\n...[truncated]...\n${text.slice(-500)}`
    : text;
}

function redactSecrets(value) {
  return String(value ?? '')
    .replace(/(orsk-)[A-Za-z0-9._-]+/g, '$1[REDACTED]')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[REDACTED]')
    .replace(/((?:TOKEN|KEY|SECRET|PASSWORD)[A-Z0-9_]*\s*=\s*)[^\s]+/gi, '$1[REDACTED]');
}

function extractJsonSummary(value) {
  const text = String(value ?? '').trim();
  const start = text.lastIndexOf('\n{');
  const jsonText = start >= 0 ? text.slice(start + 1) : text.startsWith('{') ? text : null;
  if (!jsonText) return null;

  try {
    const parsed = JSON.parse(jsonText);
    return {
      stage: parsed.stage ?? parsed.plan?.stage,
      result: parsed.result,
      nextAction: parsed.nextAction,
      routeTo: parsed.routeTo,
      failureType: parsed.failureType,
      artifactDir: parsed.artifactDir,
      notionActivityPageId: parsed.notionActivityPageId,
      durationMs: parsed.durationMs,
    };
  } catch {
    return null;
  }
}

function printHelp() {
  console.log(`Activity runner

Usage:
  pnpm activity:run --activity <id> --attempt <id> [options]

Behavior:
  Reads local activity artifacts, executes exactly one valid next stage, and stops at approval gates.

Options:
  --dry-run true             Show the next action without executing it
  --intent <text>            Create test and capture plans when missing
  --test-approval <status>   Record Test stage approval when test scope is waiting
  --approval <status>        Record approval when capture is waiting
  --verdict <status>         Record validation verdict when validation is waiting
  --write                    Pass through to Notion sync when it is the next stage
`);
}
