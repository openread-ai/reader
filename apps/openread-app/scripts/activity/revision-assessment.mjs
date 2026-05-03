#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
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
const artifactDir = resolve(config.attemptDir, 'revision-assessment');
const maxLoops = Number.isFinite(Number(args.maxLoops)) ? Number(args.maxLoops) : 3;

ensureDir(artifactDir);

const validationReport = latestAttemptReport('stage-8-validation/validation-report.json');
const validationCheckpoint = latestAttemptReport(
  'stage-8-validation/validation-checkpoint-report.json',
);
const validationVerdict = latestAttemptReport('stage-8-validation/validation-verdict.json');
const probeProgress = readJsonIfExists(
  resolve(process.cwd(), 'test-results/ai-probes/progress.json'),
);
const loopCount = failedVerdictCount();
const assessment = assess();
const finishedAt = new Date().toISOString();

const report = {
  schemaVersion: 1,
  stage: 'revision-assessment',
  result: assessment.routeTo === 'blocked' ? 'failed' : 'passed',
  activityId: config.activityId,
  activityUuid: config.activityUuid,
  attemptId: config.attemptId,
  loopCount,
  maxLoops,
  verdict: validationVerdict?.verdict ?? null,
  validationResult: validationReport?.result ?? validationCheckpoint?.result ?? null,
  failureType: assessment.failureType,
  routeTo: assessment.routeTo,
  reason: assessment.reason,
  issueScope: assessment.issueScope,
  sourceArtifacts: {
    validationReport: validationReport
      ? resolve(
          validationReport.attemptDir ?? config.attemptDir,
          'stage-8-validation/validation-report.json',
        )
      : null,
    validationCheckpoint: validationCheckpoint
      ? resolve(
          validationCheckpoint.attemptDir ?? config.attemptDir,
          'stage-8-validation/validation-checkpoint-report.json',
        )
      : null,
    validationVerdict: validationVerdict
      ? resolve(
          validationVerdict.attemptDir ?? config.attemptDir,
          'stage-8-validation/validation-verdict.json',
        )
      : null,
    probeProgress: probeProgress
      ? resolve(process.cwd(), 'test-results/ai-probes/progress.json')
      : null,
  },
  artifactDir,
  nextAction: nextAction(assessment.routeTo, assessment.issueScope),
  startedAt,
  finishedAt,
  durationMs: Date.now() - startedAtMs,
  stageTiming: {
    startedAt,
    finishedAt,
    durationMs: Date.now() - startedAtMs,
  },
  createdAt: startedAt,
};

writeJson(resolve(artifactDir, 'revision-assessment-report.json'), report);
console.log(JSON.stringify(report, null, 2));
process.exit(report.result === 'failed' ? 1 : 0);

function assess() {
  if (loopCount > maxLoops) {
    return {
      failureType: 'blocked',
      routeTo: 'blocked',
      reason: `Max validation revision loops exceeded (${loopCount}/${maxLoops}).`,
      issueScope: baseIssueScope({ outOfScope: ['automatic retries'] }),
    };
  }

  if (!validationReport) {
    return {
      failureType: 'validation-retry',
      routeTo: 'validation',
      reason: validationCheckpoint
        ? 'Final validation report is missing but checkpoint evidence exists; resume validation.'
        : 'Validation evidence is missing; rerun validation before implementation changes.',
      issueScope: baseIssueScope({ allowedImplementationScope: [] }),
    };
  }

  if (!['passed', 'failed'].includes(validationReport.result)) {
    return {
      failureType: 'validation-retry',
      routeTo: 'validation',
      reason: `Validation result is ${validationReport.result}; only definitive passed/failed validation can drive implementation revision.`,
      issueScope: baseIssueScope({ allowedImplementationScope: [] }),
    };
  }

  const incompleteProbe = incompleteProbeSummary();
  if (incompleteProbe) {
    return {
      failureType: 'validation-retry',
      routeTo: 'validation',
      reason: `Probe validation is incomplete; next unfinished probe is ${incompleteProbe.nextProbeId ?? 'unknown'}.`,
      issueScope: baseIssueScope({
        probeId: incompleteProbe.nextProbeId,
        allowedImplementationScope: [],
      }),
    };
  }

  const readinessReason = readinessFailureReason();
  if (readinessReason) {
    return {
      failureType: 'readiness',
      routeTo: 'readiness',
      reason: readinessReason,
      issueScope: baseIssueScope({ allowedImplementationScope: [] }),
    };
  }

  const failedProbe = failedProbeSummary();
  if (failedProbe) {
    return {
      failureType: 'code',
      routeTo: 'implementation',
      reason: `Validation probe failed: ${failedProbe.id}.`,
      issueScope: baseIssueScope({
        probeId: failedProbe.id,
        expected: failedProbe.expected ?? 'Approved probe expectation passes.',
        actual: failedProbe.actual ?? failedProbe.error ?? 'Probe reported failure.',
        evidence: failedProbe.screenshots ?? failedProbe.evidence ?? [],
        allowedImplementationScope: [
          `Fix only the behavior covered by validation probe ${failedProbe.id}.`,
        ],
        outOfScope: [
          'unrelated probe harness rewrites',
          'unrelated product behavior',
          'quota policy changes',
        ],
      }),
    };
  }

  const commandFailure = firstFailedTestRun();
  if (commandFailure) {
    return {
      failureType: 'code',
      routeTo: 'implementation',
      reason: `Approved validation command failed: ${commandFailure.command}.`,
      issueScope: baseIssueScope({
        expected: 'Approved validation command exits successfully.',
        actual: `Exit code ${commandFailure.exitCode ?? 'unknown'}.`,
        evidence: [commandFailure.stdoutPath, commandFailure.stderrPath].filter(Boolean),
        allowedImplementationScope: [
          'Fix only the behavior exercised by the failed validation command.',
        ],
        outOfScope: ['unrelated test rewrites', 'broad refactors'],
      }),
    };
  }

  const missingEvidence = missingEvidenceReason();
  if (missingEvidence) {
    return {
      failureType: 'validation-retry',
      routeTo: 'validation',
      reason: missingEvidence,
      issueScope: baseIssueScope({ allowedImplementationScope: [] }),
    };
  }

  return {
    failureType: 'blocked',
    routeTo: 'blocked',
    reason:
      'Validation failed but deterministic assessment could not identify a safe scoped implementation issue.',
    issueScope: baseIssueScope({ outOfScope: ['automatic broad implementation'] }),
  };
}

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

function failedVerdictCount() {
  if (!existsSync(config.activityDir)) return validationVerdictFailed(validationVerdict) ? 1 : 0;
  return readdirSync(config.activityDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) =>
      readJsonIfExists(
        resolve(config.activityDir, entry.name, 'stage-8-validation/validation-verdict.json'),
      ),
    )
    .filter(validationVerdictFailed).length;
}

function validationVerdictFailed(report) {
  return ['needs-revision', 'rejected'].includes(String(report?.verdict ?? '').toLowerCase());
}

function incompleteProbeSummary() {
  const summary =
    validationCheckpoint?.probeProgress ??
    validationCheckpoint?.progressSummary ??
    validationCheckpoint?.probeSummary;
  if (summary && Number(summary.completed ?? 0) < Number(summary.total ?? 0)) {
    return { nextProbeId: summary.nextProbeId ?? summary.currentProbe ?? null };
  }

  const probes = probeProgress?.probes;
  if (!probes || typeof probes !== 'object') return null;
  const next = Object.values(probes).find((probe) => probe?.completed !== true);
  return next ? { nextProbeId: next.id ?? next.probeId ?? null } : null;
}

function failedProbeSummary() {
  const progressProbe = firstFailedProbeFromProgress();
  if (progressProbe) return progressProbe;

  const summaries = [
    validationReport?.playwrightEvidence,
    validationCheckpoint?.probeProgress,
    validationCheckpoint?.progressSummary,
  ]
    .flatMap((value) => value?.probes ?? [])
    .filter(Boolean);
  return summaries.find((probe) => probe.status && probe.status !== 'passed') ?? null;
}

function firstFailedProbeFromProgress() {
  const probes = probeProgress?.probes;
  if (!probes || typeof probes !== 'object') return null;
  return (
    Object.values(probes).find(
      (probe) => probe?.completed === true && probe?.status !== 'passed',
    ) ?? null
  );
}

function firstFailedTestRun() {
  return validationReport?.testRuns?.find((run) => run.result === 'failed') ?? null;
}

function readinessFailureReason() {
  const text = [
    ...(validationReport?.testRuns ?? []).flatMap((run) => [
      readText(run.stderrPath),
      readText(run.stdoutPath),
    ]),
  ]
    .join('\n')
    .toLowerCase();
  if (!text) return null;
  if (
    text.includes('browser executable') ||
    text.includes('please run pnpm exec playwright install')
  ) {
    return 'Playwright browser dependency is missing; return to Readiness.';
  }
  if (text.includes('econnrefused') || text.includes('web server') || text.includes('dev server')) {
    return 'Validation environment/dev server is unavailable; return to Readiness.';
  }
  if (text.includes('auth') && text.includes('fixture')) {
    return 'Validation auth fixture failed; return to Readiness.';
  }
  return null;
}

function missingEvidenceReason() {
  const probeCommandRequested = (validationReport?.testRuns ?? []).some((run) =>
    String(run.command ?? '').includes('test:e2e:probes'),
  );
  const screenshotCount = Number(validationReport?.playwrightEvidence?.screenshotCount ?? 0);
  if (probeCommandRequested && screenshotCount === 0) {
    return 'Approved probe validation ran without screenshot evidence; rerun validation evidence capture.';
  }

  const missingCapture = validationReport?.validations?.find((validation) =>
    String(validation.reason ?? '').includes('implementation capture missing'),
  );
  if (missingCapture)
    return 'Implementation capture evidence is missing; rerun validation capture.';

  return null;
}

function baseIssueScope(overrides = {}) {
  return {
    source: 'validation',
    verdictPath: validationVerdict
      ? resolve(
          validationVerdict.attemptDir ?? config.attemptDir,
          'stage-8-validation/validation-verdict.json',
        )
      : resolve(config.stage8Dir, 'validation-verdict.json'),
    validationPath: validationReport
      ? resolve(
          validationReport.attemptDir ?? config.attemptDir,
          'stage-8-validation/validation-report.json',
        )
      : null,
    probeId: null,
    expected: 'Validation evidence matches the approved expectation.',
    actual: validationReport?.result ?? validationCheckpoint?.result ?? 'missing',
    evidence: [],
    allowedImplementationScope: [],
    outOfScope: ['unrelated implementation work'],
    ...overrides,
  };
}

function nextAction(routeTo, issueScope) {
  if (routeTo === 'implementation') {
    return `Run scoped implementation for validation issue${issueScope?.probeId ? ` ${issueScope.probeId}` : ''}.`;
  }
  if (routeTo === 'validation') return 'Resume/rerun validation; do not mutate implementation.';
  if (routeTo === 'readiness') return 'Rerun readiness/tooling checks before validation.';
  return 'Manual review required; automatic revision loop is blocked.';
}

function readText(path) {
  if (!path || !existsSync(path)) return '';
  return readFileSync(path, 'utf8').slice(-20_000);
}

function printHelp() {
  console.log(`Activity revision assessment

Usage:
  pnpm activity:revision-assessment --activity <id> --attempt <id> [--max-loops 3]

Classifies a definitive failed validation verdict and routes deterministically to implementation, validation, readiness, or blocked.
`);
}
