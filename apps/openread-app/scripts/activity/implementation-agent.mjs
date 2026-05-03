#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ensureDir,
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
const appRoot = process.cwd();
const repoRoot = git(['rev-parse', '--show-toplevel'], { cwd: appRoot }) || appRoot;
const artifactDir = resolve(config.attemptDir, 'implementation-agent');
const resultPath = resolve(artifactDir, 'implementation-agent-result.json');
const evidencePath = resolve(artifactDir, 'evidence.md');
const promptPath = resolve(artifactDir, 'prompt.md');
const stdoutPath = resolve(artifactDir, 'pi-stdout.log');
const stderrPath = resolve(artifactDir, 'pi-stderr.log');

ensureDir(artifactDir);

const reportBase = {
  schemaVersion: 1,
  stage: 'implementation-agent',
  activityId: config.activityId,
  activityUuid: config.activityUuid,
  attemptId: config.attemptId,
  artifactDir,
  evidencePath,
  resultPath,
  gitBefore: gitSummary(),
  startedAt,
  createdAt: startedAt,
};

const prompt = buildPrompt();
writeFileSync(promptPath, prompt);

const piArgs = [
  '-p',
  '--thinking',
  String(args.thinking ?? 'minimal'),
  '--session-dir',
  resolve(artifactDir, 'pi-sessions'),
  '--tools',
  String(args.tools ?? 'read,bash,edit,write,grep,find,ls'),
  prompt,
];

const child = spawnSync('pi', piArgs, {
  cwd: repoRoot,
  env: {
    ...process.env,
    OPENREAD_ACTIVITY_IMPLEMENTATION_RESULT: resultPath,
    OPENREAD_ACTIVITY_IMPLEMENTATION_EVIDENCE: evidencePath,
  },
  encoding: 'utf8',
  stdio: 'pipe',
  maxBuffer: 50 * 1024 * 1024,
});

writeFileSync(stdoutPath, redactSecrets(child.stdout));
writeFileSync(stderrPath, redactSecrets(child.stderr));

const agentResult = readJsonIfExists(resultPath);
const result = normalizeResult(child, agentResult);
const summary =
  oneLine(agentResult?.summary) ||
  (result === 'passed'
    ? 'Implementation agent completed. See evidence artifact.'
    : 'Implementation agent did not complete successfully.');

if (!existsSync(evidencePath)) {
  writeFileSync(
    evidencePath,
    `# Implementation Evidence\n\nResult: ${result}\n\nSummary: ${summary}\n\nStdout: ${stdoutPath}\n\nStderr: ${stderrPath}\n`,
  );
}

const report = {
  ...reportBase,
  result,
  summary,
  nextAction:
    result === 'passed'
      ? 'Mark implementation completed, then run Stage 8 validation.'
      : 'Resolve implementation agent blocker before validation.',
  pi: {
    command: `pi ${piArgs.slice(0, -1).join(' ')} <prompt>`,
    exitCode: child.status ?? 1,
    error: child.error?.message ?? null,
    stdoutPath,
    stderrPath,
  },
  agentResult: agentResult ?? null,
  gitAfter: gitSummary(),
  finishedAt: new Date().toISOString(),
  durationMs: Date.now() - startedAtMs,
};

writeJson(resolve(artifactDir, 'implementation-agent-report.json'), report);
console.log(JSON.stringify(report, null, 2));
process.exit(result === 'passed' ? 0 : 1);

function buildPrompt() {
  const contextFiles = contextFilePaths();
  const contextList = contextFiles.map((path) => `- ${path}`).join('\n') || '- none found';
  const testPlan = readJsonIfExists(resolve(config.attemptDir, 'test-plan/test-plan-report.json'));
  const previousTestPlan = latestAttemptReport('test-plan/test-plan-report.json');
  const approval = latestAttemptReport('approval/approval-report.json');
  const implementation = readJsonIfExists(
    resolve(config.attemptDir, 'implementation/implementation-report.json'),
  );
  const revisionAssessment = latestAttemptReport(
    'revision-assessment/revision-assessment-report.json',
  );
  const activity = readJsonIfExists(resolve(config.activityDir, 'activity.json'));

  return `You are the Openread Activity Implementation stage agent.

Your job is to perform the actual implementation work for the approved Activity before Stage 8 validation. Do not merely mark state.

Activity:
- ID: ${config.activityId}
- UUID: ${config.activityUuid ?? 'not-set'}
- Attempt: ${config.attemptId}
- Title: ${activity?.title ?? 'unknown'}
- Repository root: ${repoRoot}
- App package root: ${appRoot}

Approved implementation context:
- Test plan: ${JSON.stringify(testPlan ?? previousTestPlan ?? null, null, 2)}
- Design approval: ${JSON.stringify(approval ?? null, null, 2)}
- Current implementation marker: ${JSON.stringify(implementation ?? null, null, 2)}
- Revision assessment, when re-entering from failed validation: ${JSON.stringify(revisionAssessment ?? null, null, 2)}

Accumulated context files to read before deciding:
${contextList}

Rules:
- Work in the current repository only.
- Check git status before mutation and include it in evidence.
- Follow AGENTS.md and FTF: one logical change = one commit; stage only specific files; never git add .
- Do not bulk cherry-pick old branches.
- Prefer evidence-backed no-op/defer decisions over risky imports.
- If revision assessment is present, fix only its issueScope. Do not broaden beyond allowedImplementationScope.
- If revision assessment routeTo is not implementation, return blocked and explain why code mutation is unsafe.
- If source changes are needed, implement them, run targeted tests, and commit each logical change.
- If no source changes are needed, write evidence explaining why.
- Do not run Stage 8 validation and do not call implementation-marker; the lifecycle runner will do that after your report passes.

Required output files:
1. Write Markdown evidence to: ${evidencePath}
2. Write JSON result to: ${resultPath}

JSON result schema:
{
  "result": "passed" | "failed" | "blocked",
  "summary": "one-line implementation summary",
  "changedFiles": ["path"],
  "commits": ["shortsha message"],
  "tests": [{ "command": "...", "result": "passed|failed|skipped", "summary": "..." }],
  "evidencePath": "${evidencePath}",
  "blockers": ["..."]
}

Return result=passed only when implementation work is actually complete or a no-op/defer decision is fully evidenced. Return blocked if scope is ambiguous or approval is insufficient.`;
}

function contextFilePaths() {
  const paths = [
    resolve(repoRoot, 'AGENTS.md'),
    resolve(config.activityDir, 'activity.json'),
    resolve(config.activityDir, 'capture-plan.json'),
    latestAttemptPath('revision-assessment/revision-assessment-report.json'),
  ].filter(Boolean);

  const mainActivityDir = resolve(config.artifactRoot, 'ACT-2026-0010-reconciliation');
  for (const name of [
    'ai-consolidation-queue.md',
    'reconciliation-parallel-queue.md',
    'ai-dev-reconciliation-queue.md',
  ]) {
    paths.push(resolve(mainActivityDir, name));
  }

  if (existsSync(mainActivityDir)) {
    for (const entry of readdirSync(mainActivityDir)) {
      if (entry.startsWith('context-scout-') && entry.endsWith('.md')) {
        paths.push(resolve(mainActivityDir, entry));
      }
    }
  }

  return [...new Set(paths)].filter((path) => existsSync(path));
}

function latestAttemptReport(relativePath) {
  const path = latestAttemptPath(relativePath);
  return path ? readJsonIfExists(path) : null;
}

function latestAttemptPath(relativePath) {
  const current = resolve(config.attemptDir, relativePath);
  if (existsSync(current)) return current;
  if (!existsSync(config.activityDir)) return null;
  return readdirSync(config.activityDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(config.activityDir, entry.name, relativePath))
    .filter((path) => existsSync(path))
    .sort((a, b) => {
      const aReport = readJsonIfExists(a);
      const bReport = readJsonIfExists(b);
      return (
        Date.parse(aReport?.finishedAt ?? aReport?.createdAt ?? '') -
        Date.parse(bReport?.finishedAt ?? bReport?.createdAt ?? '')
      );
    })
    .at(-1);
}

function normalizeResult(child, agentResult) {
  const value = String(agentResult?.result ?? '').toLowerCase();
  if (['passed', 'failed', 'blocked'].includes(value)) {
    return value === 'blocked' ? 'failed' : value;
  }
  if (child.error) return 'failed';
  if ((child.status ?? 1) !== 0) return 'failed';
  return 'failed';
}

function gitSummary() {
  const status = git(['status', '--short'], { cwd: repoRoot });
  return {
    branch: git(['branch', '--show-current'], { cwd: repoRoot }),
    head: git(['rev-parse', '--short', 'HEAD'], { cwd: repoRoot }),
    clean: status === '',
    status,
  };
}

function git(gitArgs, options = {}) {
  const result = spawnSync('git', gitArgs, {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function oneLine(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

function redactSecrets(value) {
  return String(value ?? '')
    .replace(/(orsk-)[A-Za-z0-9._-]+/g, '$1[REDACTED]')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[REDACTED]')
    .replace(/((?:TOKEN|KEY|SECRET|PASSWORD)[A-Z0-9_]*\s*=\s*)[^\s]+/gi, '$1[REDACTED]');
}

function printHelp() {
  console.log(`Activity implementation agent

Usage:
  pnpm activity:implementation-agent --activity <id> --attempt <id> [options]

Runs a non-interactive Pi implementation agent for the Activity and writes implementation evidence.
`);
}
