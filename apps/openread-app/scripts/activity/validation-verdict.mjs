#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ensureDir, getActivityConfig, parseArgs, readJsonIfExists, writeJson } from './common.mjs';

const argv = process.argv.slice(2);
const args = parseArgs(argv);
if (args.help || args.h) {
  printHelp();
  process.exit(0);
}

const config = getActivityConfig(argv);
const startedAtMs = Date.now();
const startedAt = new Date(startedAtMs).toISOString();
const artifactDir = config.stage8Dir;
const validationReport = latestAttemptReport('stage-8-validation/validation-report.json');
const validationResult = validationReport?.result ?? null;
const definitiveValidation = ['passed', 'failed'].includes(validationResult);

if (!definitiveValidation) {
  fail(
    'Validation Verdict requires a definitive validation-report.json with result passed or failed. Resume Validation first.',
  );
}

const requestedVerdict = String(args.verdict ?? defaultVerdict(validationResult)).toLowerCase();
if (!['approved', 'rejected', 'needs-revision'].includes(requestedVerdict)) {
  fail('--verdict must be approved, rejected, or needs-revision');
}

const validationReportPath = validationReport
  ? resolve(
      validationReport.attemptDir ?? config.attemptDir,
      'stage-8-validation/validation-report.json',
    )
  : resolve(config.stage8Dir, 'validation-report.json');
const supportingContext = loadSupportingContext(validationReport);
const verdictReview = buildVerdictReview({
  validationReport,
  validationReportPath,
  supportingContext,
});
const verdict = resolveFinalVerdict(requestedVerdict, verdictReview);

ensureDir(artifactDir);

const finishedAt = new Date().toISOString();
const durationMs = Date.now() - startedAtMs;
const report = {
  schemaVersion: 2,
  stage: 'validation-verdict',
  result: verdict === 'approved' ? 'passed' : 'failed',
  verdict,
  requestedVerdict,
  recommendedVerdict: verdictReview.recommendedVerdict,
  activityId: config.activityId,
  activityUuid: config.activityUuid,
  attemptId: config.attemptId,
  reviewer: args.reviewer ?? process.env.USER ?? 'unknown',
  reason: args.reason ?? verdictReview.reason ?? defaultReason(validationReport, verdict),
  validationResult,
  definitiveValidation,
  validationReportPath,
  artifactDir,
  verdictReview,
  routeBackTo: verdict === 'approved' ? null : 'revision-assessment',
  nextAction:
    verdict === 'approved'
      ? nextActionAfterApproved(verdictReview)
      : 'Run Revision Assessment to classify the specific validation issue before any implementation retry.',
  startedAt,
  finishedAt,
  durationMs,
  stageTiming: {
    startedAt,
    finishedAt,
    durationMs,
  },
  createdAt: startedAt,
};

writeJson(resolve(artifactDir, 'validation-verdict.json'), report);
console.log(JSON.stringify(report, null, 2));
process.exit(0);

function latestAttemptReport(relativePath) {
  const current = readJsonIfExists(resolve(config.attemptDir, relativePath));
  if (current) return { ...current, attemptDir: config.attemptDir };
  if (!existsSync(config.activityDir)) return null;
  return readdirSync(config.activityDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const attemptDir = resolve(config.activityDir, entry.name);
      const report = readJsonIfExists(resolve(attemptDir, relativePath));
      return report ? { ...report, attemptDir } : null;
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        Date.parse(a.finishedAt ?? a.createdAt ?? '') -
        Date.parse(b.finishedAt ?? b.createdAt ?? ''),
    )
    .at(-1);
}

function loadSupportingContext(validationReport) {
  return {
    activity: readJsonIfExists(resolve(config.activityDir, 'activity.json')),
    implementation: latestAttemptReportBefore(
      'implementation/implementation-report.json',
      validationReport,
    ),
    implementationAgent: latestAttemptReportBefore(
      'implementation-agent/implementation-agent-report.json',
      validationReport,
    ),
    git: readGitContext(),
  };
}

function latestAttemptReportBefore(relativePath, predecessor) {
  if (!existsSync(config.activityDir)) return null;
  const predecessorMs = Date.parse(predecessor?.startedAt ?? predecessor?.createdAt ?? '') || null;
  return readdirSync(config.activityDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const attemptDir = resolve(config.activityDir, entry.name);
      const report = readJsonIfExists(resolve(attemptDir, relativePath));
      return report ? { ...report, attemptDir } : null;
    })
    .filter(Boolean)
    .filter((report) => {
      if (!predecessorMs) return true;
      const reportMs = Date.parse(report.finishedAt ?? report.createdAt ?? '');
      return Number.isFinite(reportMs) && reportMs <= predecessorMs;
    })
    .sort(
      (a, b) =>
        Date.parse(a.finishedAt ?? a.createdAt ?? '') -
        Date.parse(b.finishedAt ?? b.createdAt ?? ''),
    )
    .at(-1);
}

function buildVerdictReview({ validationReport, validationReportPath, supportingContext }) {
  const findings = [];
  const questions = [];
  const expected = validationReport?.verdictInput?.expected ?? {};
  const actual = validationReport?.verdictInput?.actual ?? {};
  const approvedTestScope =
    validationReport?.approvedTestScope ?? expected.approvedTestScope ?? null;
  const approvedCommands = Array.isArray(approvedTestScope?.commands)
    ? approvedTestScope.commands
    : [];
  const testRuns = Array.isArray(validationReport?.testRuns) ? validationReport.testRuns : [];
  const screenshotCount = Number(
    validationReport?.playwrightEvidence?.screenshotCount ?? actual.screenshotCount ?? 0,
  );
  const validationCount = Number(
    actual.validationCount ?? validationReport?.validations?.length ?? 0,
  );
  const stdoutTexts = testRuns.map((run) => readTextIfExists(run.stdoutPath));
  const realTestCaseReview = buildRealTestCaseReview({
    testRuns,
    approvedCommands,
    stdoutTexts,
    screenshots: validationReport?.playwrightEvidence?.screenshots ?? [],
  });

  addCheck(findings, {
    id: 'definitive-validation',
    ok: validationReport?.definitiveValidation === true,
    severity: 'error',
    detail: 'Validation report must be definitive before verdict.',
  });
  addCheck(findings, {
    id: 'validation-result-passed',
    ok: validationReport?.result === 'passed',
    severity: 'error',
    detail: `Validation result is ${validationReport?.result ?? 'missing'}.`,
  });
  addCheck(findings, {
    id: 'approved-test-command-ran',
    ok:
      approvedCommands.length === 0 ||
      approvedCommands.every((command) =>
        testRuns.some(
          (run) => run.command === command && run.result === 'passed' && run.exitCode === 0,
        ),
      ),
    severity: 'error',
    detail: 'Every approved test command must have a passing test run.',
  });
  addCheck(findings, {
    id: 'real-test-case-results-passed',
    ok: realTestCaseReview.failed.length === 0 && realTestCaseReview.started.length > 0,
    severity: 'error',
    detail: 'The real probe/test cases parsed from test output must finish passing.',
  });
  addCheck(findings, {
    id: 'playwright-evidence-present',
    ok: screenshotCount > 0,
    severity: 'error',
    detail: `Expected Playwright screenshot evidence; found ${screenshotCount}.`,
  });
  addCheck(findings, {
    id: 'no-reported-validation-failures',
    ok:
      (actual.failures?.length ?? 0) === 0 &&
      (actual.missingEvidence?.length ?? 0) === 0 &&
      !validationReport?.testRuns?.some((run) => run.result === 'failed'),
    severity: 'error',
    detail: 'Validation report must not contain failures or missing evidence.',
  });
  addCheck(findings, {
    id: 'no-validation-worktree-mutation',
    ok: validationReport?.validationDidMutateWorktree === false,
    severity: 'error',
    detail: 'Validation must not mutate the worktree.',
  });
  addCheck(findings, {
    id: 'implementation-capture-present',
    ok: validationCount > 0 && validationReport?.captureExitCode === 0,
    severity: 'warning',
    detail: 'Implementation capture should exist to anchor visual/evidence review.',
  });

  const evidenceQuestions = extractEvidenceQuestions(stdoutTexts);
  questions.push(...evidenceQuestions);

  const intentAdherenceReview = buildIntentAdherenceReview({
    validationReport,
    approvedTestScope,
    supportingContext,
    realTestCaseReview,
  });
  questions.push(...intentAdherenceReview.questions);

  const initialPrReview = buildInitialPrReview(supportingContext.git);
  questions.push(...initialPrReview.questions);

  const blockingFindings = findings.filter(
    (finding) => finding.severity === 'error' && !finding.ok,
  );
  const recommendedVerdict = blockingFindings.length > 0 ? 'needs-revision' : 'approved';
  const reason =
    recommendedVerdict === 'approved'
      ? 'Validation evidence matches approved expectation and real test cases passed.'
      : `Validation evidence has ${blockingFindings.length} blocking gap(s).`;

  return {
    validationReportPath,
    expected: {
      activityTitle: supportingContext.activity?.title ?? null,
      approvedTestScope,
      approvedCommands,
    },
    actual: {
      validationResult: validationReport?.result ?? null,
      definitiveValidation: validationReport?.definitiveValidation === true,
      testRunCount: testRuns.length,
      screenshotCount,
      validationCount,
      validationDidMutateWorktree: validationReport?.validationDidMutateWorktree ?? null,
    },
    realTestCaseReview,
    evidenceReview: {
      checks: findings,
      blockingFindings,
    },
    intentAdherenceReview,
    initialPrReview,
    questions,
    recommendedVerdict,
    reason,
  };
}

function buildRealTestCaseReview({ testRuns, approvedCommands, stdoutTexts, screenshots }) {
  const parsedProbeResults = stdoutTexts.flatMap(parseProbeResults);
  const started = parsedProbeResults
    .filter((probe) => probe.event === 'started')
    .map((probe) => probe.id);
  const finished = parsedProbeResults.filter((probe) => probe.event === 'finished');
  const failed = finished.filter((probe) => probe.status !== 'passed');
  const screenshotProbeIds = Array.from(
    new Set(
      screenshots
        .map((shot) => `${shot.evidencePath ?? shot.sourcePath ?? ''}`)
        .map((path) => path.match(/([A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+)/)?.[1])
        .filter(Boolean),
    ),
  ).sort();

  return {
    approvedCommands,
    testRuns: testRuns.map((run) => ({
      command: run.command,
      result: run.result,
      exitCode: run.exitCode,
      durationMs: run.durationMs,
      stdoutPath: run.stdoutPath ?? null,
    })),
    started: Array.from(new Set(started)).sort(),
    finished: finished.map(({ id, status }) => ({ id, status })),
    failed,
    screenshotProbeIds,
    summary:
      failed.length === 0
        ? `${finished.length} parsed probe/test case result(s) passed.`
        : `${failed.length} parsed probe/test case result(s) failed.`,
  };
}

function parseProbeResults(text) {
  const clean = stripAnsi(text);
  const results = [];
  for (const match of clean.matchAll(/^Starting ([A-Z0-9_]+):/gm)) {
    results.push({ event: 'started', id: match[1] });
  }
  for (const match of clean.matchAll(
    /^Finished ([A-Z0-9_]+): (passed|failed|skipped|timed-out)/gm,
  )) {
    results.push({ event: 'finished', id: match[1], status: match[2] });
  }
  return results;
}

function buildIntentAdherenceReview({
  validationReport,
  approvedTestScope,
  supportingContext,
  realTestCaseReview,
}) {
  const questions = [];
  const implementation = supportingContext.implementation;
  const implementationAgent = supportingContext.implementationAgent;
  const requestedE2e = approvedTestScope?.e2eTests ?? [];
  const commandCoverage = (approvedTestScope?.commands ?? []).map((command) => ({
    command,
    coveredByValidation:
      validationReport?.testRuns?.some((run) => run.command === command) ?? false,
  }));

  if (!implementation && !implementationAgent) {
    questions.push({
      severity: 'non-blocking',
      question:
        'No implementation/implementation-agent report was found before validation; confirm the Activity intent is fully represented by the validation evidence and commits.',
    });
  }

  if (requestedE2e.length > 0 && realTestCaseReview.finished.length === 0) {
    questions.push({
      severity: 'non-blocking',
      question:
        'Approved e2e scope exists, but no concrete probe/test-case results were parsed; evidenceReview will block if this is required for the verdict.',
    });
  }

  return {
    activityTitle: supportingContext.activity?.title ?? null,
    approvedE2eScope: requestedE2e,
    commandCoverage,
    implementationSummary:
      implementationAgent?.summary ??
      implementation?.summary ??
      implementation?.implementationSummary ??
      null,
    implementationAttempt: implementationAgent?.attemptId ?? implementation?.attemptId ?? null,
    coverageStatement:
      commandCoverage.every((entry) => entry.coveredByValidation) &&
      realTestCaseReview.failed.length === 0
        ? 'Approved test scope was exercised by validation evidence.'
        : 'Approved test scope has uncovered or failed evidence.',
    questions,
  };
}

function buildInitialPrReview(git) {
  const changedFiles = git.changedFilesSinceOrigin ?? [];
  const relevantFiles = changedFiles.filter((file) =>
    /(^apps\/openread-app\/(e2e|src\/components\/assistant|scripts\/activity|scripts\/run-ai-probes)|docs\/testing\/ai-chat-probes\.md)/.test(
      file,
    ),
  );
  const questions = [];

  if (!git.clean) {
    questions.push({
      severity: 'non-blocking',
      question:
        'Worktree is dirty during verdict; carry this forward to final hygiene/handoff if these are intentional verdict-stage edits.',
    });
  }
  if (changedFiles.length > 0 && relevantFiles.length === 0) {
    questions.push({
      severity: 'non-blocking',
      question:
        'PR diff has no obvious AI probe/assistant/activity files in the first-pass path filter; confirm the changed files map to the Activity intent.',
    });
  }

  return {
    branch: git.branch,
    head: git.head,
    clean: git.clean,
    changedFilesSinceOriginCount: changedFiles.length,
    relevantChangedFiles: relevantFiles.slice(0, 50),
    omittedChangedFiles: Math.max(changedFiles.length - 50, 0),
    alignmentStatement:
      relevantFiles.length > 0
        ? 'First-pass PR review found files aligned with AI probe/assistant/activity intent.'
        : 'First-pass PR review could not infer intent alignment from file paths alone.',
    questions,
  };
}

function extractEvidenceQuestions(stdoutTexts) {
  const questions = [];
  const clean = stripAnsi(stdoutTexts.join('\n'));
  const bugLines = clean
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /\bBUG\b|← BUG:/i.test(line))
    .slice(0, 5);

  for (const line of bugLines) {
    questions.push({
      severity: 'non-blocking',
      question: `Passing validation evidence still contains a bug marker: ${line}`,
    });
  }

  return questions;
}

function addCheck(findings, finding) {
  findings.push({
    id: finding.id,
    ok: Boolean(finding.ok),
    severity: finding.severity,
    detail: finding.detail,
  });
}

function resolveFinalVerdict(requestedVerdict, verdictReview) {
  if (requestedVerdict === 'rejected') return 'rejected';
  if (verdictReview.recommendedVerdict !== 'approved') return verdictReview.recommendedVerdict;
  return requestedVerdict || verdictReview.recommendedVerdict;
}

function nextActionAfterApproved(verdictReview) {
  const nonBlockingQuestions = verdictReview.questions.filter(
    (question) => question.severity !== 'blocking',
  );
  if (nonBlockingQuestions.length > 0) {
    return 'Proceed to Final Quality Gate; carry forward non-blocking verdict questions.';
  }
  return 'Proceed to Final Quality Gate.';
}

function defaultVerdict(validationResult) {
  if (validationResult === 'passed') return 'approved';
  if (validationResult === 'failed') return 'needs-revision';
  return '';
}

function defaultReason(validationReport, verdict) {
  if (verdict === 'approved') return 'Definitive validation passed.';
  const failedRun = validationReport?.testRuns?.find((run) => run.result === 'failed');
  if (failedRun) return `Definitive validation failed: ${failedRun.command}`;
  const failedValidation = validationReport?.validations?.find(
    (validation) => validation.result === 'failed',
  );
  if (failedValidation) return `Definitive validation failed: ${failedValidation.reason}`;
  return 'Definitive validation failed; run Revision Assessment for scoped routing.';
}

function readGitContext() {
  const branch = runGit(['branch', '--show-current']).trim() || null;
  const head = runGit(['rev-parse', '--short=9', 'HEAD']).trim() || null;
  const status = runGit(['status', '--short']);
  const changedFilesSinceOrigin = runGit(['diff', '--name-only', 'origin/main...HEAD'])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    branch,
    head,
    clean: status.trim().length === 0,
    status: status.trim(),
    changedFilesSinceOrigin,
  };
}

function runGit(args) {
  const result = spawnSync('git', args, { cwd: process.cwd(), encoding: 'utf8' });
  if (result.status !== 0) return '';
  return result.stdout ?? '';
}

function readTextIfExists(path) {
  if (!path || !existsSync(path)) return '';
  return readFileSync(path, 'utf8');
}

function stripAnsi(value) {
  return String(value).replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function printHelp() {
  console.log(`Activity validation verdict

Usage:
  pnpm activity:validation-verdict --activity <id> --attempt <id> --verdict approved|rejected|needs-revision [options]

Options:
  --reviewer <name>  Reviewer or agent recording the verdict
  --reason <text>    Short rationale or required revision
`);
}
