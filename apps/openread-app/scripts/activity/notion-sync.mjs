#!/usr/bin/env node
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  formatActivityTimestamp,
  getActivityConfig,
  loadActivityEnv,
  parseArgs,
  readJsonIfExists,
  writeJson,
} from './common.mjs';

const DEFAULT_NOTION_TARGET = '34c159c7f71980b99fdbf952588a4f50';
const NOTION_API_VERSION = '2022-06-28';
const STAGE_LABELS = {
  'stage-context': 'Intake',
  'design-source': 'Design Source',
  'test-case-planning': 'Test Case Planning',
  'test-approval': 'Test Case Planning',
  'capture-planning': 'Scoping',
  'activity-bootstrap': 'Setup',
  'stage-3-readiness': 'Readiness',
  'stage-3-platform-test': 'Readiness',
  'android-platform-smoke': 'Readiness',
  'stage-4-current-capture': 'Current Capture',
  'stage-4-browser-capture': 'Current Capture',
  'stage-4-native-capture': 'Current Capture',
  approval: 'Design Approval Gate',
  implementation: 'Implementation',
  'implementation-agent': 'Implementation',
  'implementation-complete': 'Implementation',
  'stage-8-validation': 'Validation',
  'validation-verdict': 'Validation Verdict',
  'revision-assessment': 'Implementation',
  'final-quality': 'Final Quality Gate',
  'final-hygiene': 'Final Hygiene / Cleanup Gate',
  'pr-handoff': 'PR Review / Handoff',
  'final-sync-close': 'Final Sync / Close Activity',
};

loadActivityEnv();

const args = parseArgs(process.argv.slice(2));
if (args.help || args.h) {
  printHelp();
  process.exit(0);
}

const config = getActivityConfig(process.argv.slice(2));
const artifactRoot = resolve(
  args.artifactRoot ??
    process.env.OPENREAD_ACTIVITY_ARTIFACT_ROOT ??
    resolve(homedir(), '.openread-dev/activity-artifacts'),
);
const activityDir = resolve(artifactRoot, config.activityId);
const activityMetadataPath = resolve(activityDir, 'activity.json');
const activityMetadata = readJsonIfExists(activityMetadataPath);
const notionConfigPath = resolveNotionConfigPath(artifactRoot);
const notionConfig = notionConfigPath ? readJsonIfExists(notionConfigPath) : null;
const notionPageId =
  args.notionPage ?? process.env.OPENREAD_NOTION_ACTIVITY_PAGE ?? DEFAULT_NOTION_TARGET;
const activityLogDatabaseId =
  args.database ??
  process.env.OPENREAD_NOTION_ACTIVITY_LOG_DATABASE ??
  notionConfig?.activityLogDatabaseId;
const dryRun = args.write !== true;

if (!existsSync(activityDir)) {
  fail(`Activity artifact directory does not exist: ${activityDir}`);
}

const attempts = loadAttempts(activityDir);
const attemptSummaries = attempts.map(compactAttempt);
const latest = latestAttemptSummary(attempts);
const git = gitSummary();
const syncedAt = new Date().toISOString();
const syncSequence = nextSyncSequence(attempts);
const agent = oneLine(args.agent ?? process.env.OPENREAD_ACTIVITY_AGENT ?? 'Chat');
const agentSummary = resolveAgentSummary({ latest, agent, syncedAt });
const syncReport = {
  schemaVersion: 1,
  stage: 'notion-sync',
  result: 'running',
  mode: dryRun ? 'dry-run' : 'write',
  activityId: config.activityId,
  activityUuid: config.activityUuid,
  notionPageId,
  activityLogDatabaseId,
  activityDir,
  latest,
  git,
  attempts: attemptSummaries,
  syncSequence,
  syncedAt,
  title: activityMetadata?.notionTitle ?? null,
  activityDate: activityMetadata?.activityDate ?? null,
  daySequence: activityMetadata?.daySequence ?? null,
  agent,
  agentSummary,
  createdAt: syncedAt,
};

const syncDir = resolve(activityDir, config.attemptId, 'notion-sync');
writeJson(resolve(syncDir, 'notion-sync-report.json'), syncReport);

if (dryRun) {
  const completedReport = {
    ...syncReport,
    result: 'passed',
    nextAction: 'Run with --write and NOTION_TOKEN to create/update this activity in Notion.',
  };
  writeJson(resolve(syncDir, 'notion-sync-report.json'), completedReport);
  console.log(JSON.stringify(completedReport, null, 2));
  process.exit(0);
}

const notionToken = process.env.NOTION_TOKEN ?? process.env.NOTION_API_KEY;
if (!notionToken) fail('NOTION_TOKEN or NOTION_API_KEY is required when --write is passed.');
if (!activityLogDatabaseId)
  fail('Activity Log database ID is required. Run activity:notion-create-log first.');

await ensureActivityLogDatabaseProperties({
  notionToken,
  activityLogDatabaseId,
});

const activityEventsDatabase = await ensureActivityEventsDatabase({
  notionToken,
  activityLogDatabaseId,
  notionConfig,
  notionConfigPath,
});

const activityPage = await upsertActivityPage({
  notionToken,
  databaseId: activityLogDatabaseId,
  activityId: config.activityId,
  activityUuid: config.activityUuid,
  attempts,
  git,
  syncedAt,
  activityMetadata,
});

const shouldWriteEvent = args.noEvent !== true;
const eventPage = shouldWriteEvent
  ? await createActivityEvent({
      notionToken,
      databaseId: activityEventsDatabase.id,
      activityPageId: activityPage.id,
      activityId: config.activityId,
      activityUuid: config.activityUuid,
      attemptId: config.attemptId,
      latest,
      syncedAt,
      agentSummary,
    })
  : null;

const response = shouldWriteEvent
  ? await appendActivitySummary({
      notionToken,
      notionPageId: activityPage.id,
      activityId: config.activityId,
      activityUuid: config.activityUuid,
      attempts,
      git,
      syncedAt,
      syncSequence,
      agentSummary,
    })
  : { id: null };

const pickupContext = pickupContextSnapshot({
  activityPage,
  eventPage,
  latest,
  syncedAt,
  agentSummary,
  activityEventsDatabaseId: activityEventsDatabase.id,
});

const completedReport = {
  ...syncReport,
  result: 'passed',
  notionActivityPageId: activityPage.id,
  notionActivityPageUrl: activityPage.url,
  notionTitle: activityPage.displayTitle,
  activityDate: activityPage.activityDate,
  daySequence: activityPage.daySequence,
  notionResponseId: response.id,
  activityEventsDatabaseId: activityEventsDatabase.id,
  activityEventPageId: eventPage?.id ?? null,
  activityEventPageUrl: eventPage?.url ?? null,
  pickupContext,
  syncSequence,
  syncedAt,
  nextAction: pickupContext.nextAction,
  finishedAt: new Date().toISOString(),
};
writeJson(resolve(syncDir, 'notion-sync-report.json'), completedReport);
console.log(JSON.stringify(completedReport, null, 2));

function pickupContextSnapshot({
  activityPage,
  eventPage,
  latest,
  syncedAt,
  agentSummary,
  activityEventsDatabaseId,
}) {
  return {
    activityId: config.activityId,
    activityUuid: config.activityUuid,
    attemptId: config.attemptId,
    artifactRoot,
    activityDir,
    notionActivityPageId: activityPage.id,
    notionActivityPageUrl: activityPage.url,
    notionTitle: activityPage.displayTitle,
    activityEventsDatabaseId,
    activityEventPageId: eventPage?.id ?? null,
    activityEventPageUrl: eventPage?.url ?? null,
    status: statusFromLatest(latest),
    currentStage: stageLabelFromLatest(latest),
    approvalStatus: approvalStatusFromLatest(latest, activityPage),
    latestResult: latest?.result ?? 'pending',
    latestAttempt: latest?.attemptId ?? config.attemptId,
    nextAction: latest?.nextAction ?? 'Review activity state and run the next lifecycle action.',
    agentSummary,
    syncedAt,
  };
}

function loadAttempts(root) {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const attemptDir = resolve(root, entry.name);
      return {
        attemptId: entry.name,
        bootstrap: readJsonIfExists(resolve(attemptDir, 'bootstrap/bootstrap-report.json')),
        stage3: readJsonIfExists(resolve(attemptDir, 'stage-3-readiness/readiness-report.json')),
        stage3PlatformTest: readJsonIfExists(
          resolve(attemptDir, 'stage-3-platform-test/platform-test-report.json'),
        ),
        stage4:
          readJsonIfExists(
            resolve(attemptDir, 'stage-4-current-capture/current-capture-report.json'),
          ) ??
          readJsonIfExists(resolve(attemptDir, 'stage-4-current-capture/capture-manifest.json')),
        stage4Native: readJsonIfExists(
          resolve(attemptDir, 'stage-4-current-capture/native/native-capture-manifest.json'),
        ),
        androidPlatformSmoke: readJsonIfExists(
          resolve(attemptDir, 'android-platform-smoke/android-smoke-report.json'),
        ),
        testPlan: readJsonIfExists(resolve(attemptDir, 'test-plan/test-plan-report.json')),
        testApproval: readJsonIfExists(
          resolve(attemptDir, 'test-approval/test-approval-report.json'),
        ),
        approval: readJsonIfExists(resolve(attemptDir, 'approval/approval-report.json')),
        implementation: readJsonIfExists(
          resolve(attemptDir, 'implementation/implementation-report.json'),
        ),
        implementationAgent: readJsonIfExists(
          resolve(attemptDir, 'implementation-agent/implementation-agent-report.json'),
        ),
        stage8:
          readJsonIfExists(resolve(attemptDir, 'stage-8-validation/validation-report.json')) ??
          readJsonIfExists(
            resolve(attemptDir, 'stage-8-validation/validation-checkpoint-report.json'),
          ),
        validationVerdict: readJsonIfExists(
          resolve(attemptDir, 'stage-8-validation/validation-verdict.json'),
        ),
        revisionAssessment: readJsonIfExists(
          resolve(attemptDir, 'revision-assessment/revision-assessment-report.json'),
        ),
        activityRun: readJsonIfExists(resolve(attemptDir, 'activity-run/activity-run-report.json')),
        stageContext: latestStageContextReport(attemptDir),
        notionSync: readJsonIfExists(resolve(attemptDir, 'notion-sync/notion-sync-report.json')),
      };
    })
    .sort(compareAttempts);
}

function compareAttempts(a, b) {
  return attemptTimestamp(a) - attemptTimestamp(b) || a.attemptId.localeCompare(b.attemptId);
}

function attemptTimestamp(attempt) {
  const report = latestReportForAttempt(attempt);
  return Date.parse(report?.finishedAt ?? report?.createdAt ?? report?.startedAt ?? '') || 0;
}

function latestReportForAttempt(attempt) {
  return [
    attempt.revisionAssessment,
    attempt.validationVerdict,
    attempt.stage8,
    attempt.implementationAgent,
    attempt.implementation,
    attempt.approval,
    attempt.testApproval,
    attempt.testPlan,
    attempt.stage4Native,
    attempt.stage4,
    attempt.stage3PlatformTest,
    attempt.androidPlatformSmoke,
    attempt.stage3,
    attempt.bootstrap,
    lifecycleReportFromActivityRun(attempt.activityRun),
    attempt.stageContext,
  ]
    .filter(Boolean)
    .sort((a, b) => reportTimestamp(a) - reportTimestamp(b))
    .at(-1);
}

function reportTimestamp(report) {
  return Date.parse(report?.finishedAt ?? report?.createdAt ?? report?.startedAt ?? '') || 0;
}

function resolveNotionConfigPath(root) {
  const localPath = resolve(root, 'notion-activity-log.json');
  if (existsSync(localPath)) return localPath;
  const sharedPath = resolve(
    homedir(),
    '.openread-dev/activity-artifacts/notion-activity-log.json',
  );
  if (existsSync(sharedPath)) return sharedPath;
  return localPath;
}

async function ensureActivityLogDatabaseProperties({ notionToken, activityLogDatabaseId }) {
  await notionRequest({
    notionToken,
    path: `/v1/databases/${normalizeNotionId(activityLogDatabaseId)}`,
    method: 'PATCH',
    body: {
      properties: {
        'Activity Created At': { date: {} },
        'Last Synced At': { date: {} },
      },
    },
  });
}

async function ensureActivityEventsDatabase({
  notionToken,
  activityLogDatabaseId,
  notionConfig,
  notionConfigPath,
}) {
  if (notionConfig?.activityEventsDatabaseId) {
    return {
      id: notionConfig.activityEventsDatabaseId,
      url: notionConfig.activityEventsUrl ?? null,
    };
  }

  const rootPageId = normalizeNotionId(
    notionConfig?.notionRootPageId ?? notionPageId ?? DEFAULT_NOTION_TARGET,
  );
  const database = await notionRequest({
    notionToken,
    path: '/v1/databases',
    method: 'POST',
    body: {
      parent: { type: 'page_id', page_id: rootPageId },
      title: [{ type: 'text', text: { content: 'Activity Events' } }],
      properties: {
        Title: { title: {} },
        Activity: {
          relation: {
            database_id: normalizeNotionId(activityLogDatabaseId),
            type: 'single_property',
            single_property: {},
          },
        },
        'Activity ID': { rich_text: {} },
        'Activity UUID': { rich_text: {} },
        Agent: { rich_text: {} },
        Summary: { rich_text: {} },
        Stage: { rich_text: {} },
        Result: {
          select: {
            options: [
              option('passed', 'green'),
              option('partial', 'yellow'),
              option('failed', 'red'),
              option('running', 'blue'),
              option('unknown', 'gray'),
            ],
          },
        },
        Attempt: { rich_text: {} },
        'Created At': { date: {} },
      },
    },
  });

  if (notionConfigPath) {
    writeJson(notionConfigPath, {
      ...(notionConfig ?? {}),
      schemaVersion: notionConfig?.schemaVersion ?? 1,
      activityLogDatabaseId,
      activityEventsDatabaseId: database.id,
      activityEventsUrl: database.url,
      updatedAt: new Date().toISOString(),
    });
  }

  return { id: database.id, url: database.url };
}

async function createActivityEvent({
  notionToken,
  databaseId,
  activityPageId,
  activityId,
  activityUuid,
  attemptId,
  latest,
  syncedAt,
  agentSummary,
}) {
  const stage = stageLabelFromLatest(latest);
  const result = latest?.result ?? 'unknown';
  return notionRequest({
    notionToken,
    path: '/v1/pages',
    method: 'POST',
    body: {
      parent: { database_id: databaseId },
      properties: {
        Title: titleProperty(`${formatTimelineTime(syncedAt)}: ${agent}`),
        Activity: { relation: [{ id: activityPageId }] },
        'Activity ID': richTextProperty(activityId),
        'Activity UUID': richTextProperty(activityUuid ?? ''),
        Agent: richTextProperty(agent),
        Summary: richTextProperty(agentSummary),
        Stage: richTextProperty(stage),
        Result: selectProperty(result),
        Attempt: richTextProperty(attemptId),
        'Created At': { date: { start: syncedAt } },
      },
    },
  });
}

async function upsertActivityPage({
  notionToken,
  databaseId,
  activityId,
  activityUuid,
  attempts,
  git,
  syncedAt,
  activityMetadata,
}) {
  const existing = await findActivityPage({ notionToken, databaseId, activityId });
  const latest = latestAttemptSummary(attempts);
  const titleState = await resolveActivityTitleState({
    notionToken,
    databaseId,
    activityId,
    existing,
    activityMetadata,
  });
  const properties = {
    Title: titleProperty(titleState.title),
    ...activityProperties({ activityId, activityUuid, latest, git, syncedAt, existing }),
  };

  persistTitleState(titleState);

  if (existing) {
    const page = await notionRequest({
      notionToken,
      path: `/v1/pages/${existing.id}`,
      method: 'PATCH',
      body: { properties },
    });
    return { ...page, ...titleState };
  }

  const page = await notionRequest({
    notionToken,
    path: '/v1/pages',
    method: 'POST',
    body: {
      parent: { database_id: databaseId },
      properties,
      children: activityPageTemplateBlocks({
        activityId,
        activityUuid,
        activityMetadata,
        attempts,
        git,
        syncedAt,
      }),
    },
  });
  return { ...page, ...titleState };
}

function activityPageTemplateBlocks({
  activityId,
  activityUuid,
  activityMetadata,
  attempts,
  git,
  syncedAt,
}) {
  return [
    timelineToggleBlock('Activity created by Openread activity workflow sync.'),
    sectionToggleBlock('Intake', [
      paragraph('Activity pickup, intent, and routing context are recorded here.'),
    ]),
    sectionToggleBlock('Design Source', [
      paragraph('Approved design, product, or current-state source references are recorded here.'),
    ]),
    sectionToggleBlock('Test Case Planning', [
      ...testSectionBlocks({ attempts, git, syncSequence: 'initial' }),
    ]),
    sectionToggleBlock(
      'Scoping',
      scopeBlocks({ activityId, activityUuid, activityMetadata, git, syncedAt }),
    ),
    sectionToggleBlock('Setup', [
      paragraph('Bootstrap and dependency setup evidence is recorded here.'),
    ]),
    sectionToggleBlock('Readiness', [
      paragraph('Readiness checks are recorded as stage reports run.'),
    ]),
    sectionToggleBlock('Current Capture', [
      paragraph('Current-state screenshots and capture metadata are attached here.'),
    ]),
    sectionToggleBlock('Design Approval Gate', [
      paragraph('Design approvals are recorded when approval-marker runs.'),
    ]),
    sectionToggleBlock('Implementation', [
      paragraph(
        'Implementation attempts, agent evidence, changed files, and commits are tracked here.',
      ),
    ]),
    sectionToggleBlock('Validation Results', [
      paragraph(
        'Validation evidence, screenshots, test results, and verdict inputs are attached here.',
      ),
    ]),
    sectionToggleBlock('Validation Verdict', [
      paragraph('Final validation verdict and reviewer decision are recorded here.'),
    ]),
    sectionToggleBlock('Final Quality Gate', [
      paragraph('Build, lint, test, simplify, and security review evidence is recorded here.'),
    ]),
    sectionToggleBlock('Final Hygiene / Cleanup Gate', [
      paragraph('Final cleanup, formatting, and workspace hygiene evidence is recorded here.'),
    ]),
    sectionToggleBlock('PR Review / Handoff', [
      paragraph('PR links, review notes, and handoff evidence are recorded here.'),
    ]),
    sectionToggleBlock('Final Sync / Close Activity', [
      paragraph('Merge evidence and final Activity closure are recorded here.'),
    ]),
    sectionToggleBlock('Artifact Ledger', [
      paragraph(
        'Canonical per-attempt artifact index: local paths, uploaded files, and Notion block IDs.',
      ),
    ]),
    sectionToggleBlock('Stage History', [
      paragraph('Stage transitions are tracked in Activity Timeline and Activity Events.'),
    ]),
    sectionToggleBlock('Attempts', [
      paragraph(
        'Attempt summaries are synced as stages run; local artifacts remain the detailed source.',
      ),
    ]),
    sectionToggleBlock('Decisions', [
      paragraph('Decisions and blockers are summarized in Activity Timeline entries.'),
    ]),
  ];
}

function scopeBlocks({ activityId, activityMetadata }) {
  return [paragraph(conciseScopeDescription(activityMetadata, activityId))];
}

function conciseScopeDescription(activityMetadata, activityId) {
  const source =
    activityMetadata?.intent ??
    activityMetadata?.description ??
    activityMetadata?.title ??
    activityMetadata?.slug ??
    activityId;
  return sentenceLimit(source, 2);
}

function sentenceLimit(value, maxSentences) {
  const normalized = oneLine(value);
  const sentences = normalized.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [normalized];
  return sentences.slice(0, maxSentences).join(' ').trim().slice(0, 500);
}

async function resolveActivityTitleState({
  notionToken,
  databaseId,
  activityId,
  existing,
  activityMetadata,
}) {
  const existingTitle = plainTitle(existing?.properties?.Title);
  const activityDate = activityMetadata?.activityDate ?? dateOnly(activityMetadata?.createdAt);
  const savedSequence = Number(activityMetadata?.daySequence);
  const savedTitle = activityMetadata?.notionTitle;

  if (isDateScopedTitle(existingTitle)) {
    return {
      title: existingTitle,
      displayTitle: existingTitle,
      activityDate: dateFromTitle(existingTitle),
      daySequence: sequenceFromTitle(existingTitle),
    };
  }

  if (savedTitle && activityDate && Number.isFinite(savedSequence)) {
    return {
      title: savedTitle,
      displayTitle: savedTitle,
      activityDate,
      daySequence: savedSequence,
    };
  }

  const daySequence = await nextDaySequence({ notionToken, databaseId, activityDate, activityId });
  const title = `${activityDate} #${daySequence}`;
  return { displayTitle: title, title, activityDate, daySequence };
}

async function nextDaySequence({ notionToken, databaseId, activityDate, activityId }) {
  const res = await notionRequest({
    notionToken,
    path: `/v1/databases/${databaseId}/query`,
    method: 'POST',
    body: { page_size: 100 },
  });

  const sequences = (res.results ?? [])
    .filter((page) => richTextValue(page.properties?.['Activity ID']) !== activityId)
    .map((page) => plainTitle(page.properties?.Title))
    .filter((title) => title.startsWith(`${activityDate} #`))
    .map(sequenceFromTitle)
    .filter(Number.isFinite);

  return Math.max(0, ...sequences) + 1;
}

function persistTitleState({ title, activityDate, daySequence }) {
  if (!activityMetadata) return;
  writeJson(activityMetadataPath, {
    ...activityMetadata,
    notionTitle: title,
    activityDate,
    daySequence,
    updatedAt: new Date().toISOString(),
  });
}

async function findActivityPage({ notionToken, databaseId, activityId }) {
  const res = await notionRequest({
    notionToken,
    path: `/v1/databases/${databaseId}/query`,
    method: 'POST',
    body: {
      filter: { property: 'Activity ID', rich_text: { equals: activityId } },
      page_size: 1,
    },
  });

  return res.results?.[0] ?? null;
}

async function appendActivitySummary({
  notionToken,
  notionPageId,
  activityId,
  activityUuid,
  attempts,
  git,
  syncedAt,
  syncSequence,
  agentSummary,
}) {
  const timelineLine = agentSummary;
  const timelineToggle = await findActivityTimelineToggle({ notionToken, notionPageId });
  if (timelineToggle) {
    const response = await notionRequest({
      notionToken,
      path: `/v1/blocks/${timelineToggle.id}/children`,
      method: 'PATCH',
      body: { children: [bulleted(timelineLine)] },
    });
    await appendValidationEvidence({ notionToken, notionPageId, attempts, git, syncSequence });
    if (args.timeline === true || args.details === true) {
      await appendOptionalDetails({
        notionToken,
        notionPageId,
        activityId,
        activityUuid,
        attempts,
        git,
        syncedAt,
        syncSequence,
      });
    }
    return response;
  }

  const blocks = [
    timelineToggleBlock(timelineLine),
    ...(args.timeline === true || args.details === true
      ? detailBlocks({ activityId, activityUuid, attempts, git, syncedAt, syncSequence })
      : []),
  ];

  const response = await notionRequest({
    notionToken,
    path: `/v1/blocks/${notionPageId}/children`,
    method: 'PATCH',
    body: { children: blocks.slice(0, 100) },
  });
  await appendValidationEvidence({ notionToken, notionPageId, attempts, git, syncSequence });
  return response;
}

async function appendOptionalDetails({
  notionToken,
  notionPageId,
  activityId,
  activityUuid,
  attempts,
  git,
  syncedAt,
  syncSequence,
}) {
  return appendBlocksToSection({
    notionToken,
    pageId: notionPageId,
    section: 'Artifact Ledger',
    children: detailBlocks({ activityId, activityUuid, attempts, git, syncedAt, syncSequence }),
  });
}

async function appendValidationEvidence({
  notionToken,
  notionPageId,
  attempts,
  git,
  syncSequence,
}) {
  const latest = latestAttemptSummary(attempts);
  if (latest?.stage !== 'stage-8-validation') return null;

  // Probe checkpoint syncs run after every probe start/finish. They should update
  // Activity state/timeline only; screenshots are uploaded by run-ai-probes per
  // probe. Appending the full test-plan evidence block on every checkpoint floods
  // Validation Results with duplicate "Validation Evidence Sync" sections.
  if (latest.result === 'partial') return null;

  const blocks = testSectionBlocks({
    attempts,
    git,
    syncSequence,
    title: `Validation Evidence Sync #${syncSequence}`,
  });
  if (blocks.length === 0) return null;

  return appendBlocksToSection({
    notionToken,
    pageId: notionPageId,
    section: 'Validation Results',
    children: blocks.slice(0, 100),
  });
}

async function appendBlocksToSection({ notionToken, pageId, section, children }) {
  if (!children?.length) return null;
  const sectionBlockId = await findOrCreateSectionBlockId({ notionToken, pageId, section });
  return notionRequest({
    notionToken,
    path: `/v1/blocks/${sectionBlockId}/children`,
    method: 'PATCH',
    body: { children },
  });
}

async function findOrCreateSectionBlockId({ notionToken, pageId, section }) {
  const existing = await findSectionBlockId({ notionToken, pageId, section });
  if (existing) return existing;

  const created = await notionRequest({
    notionToken,
    path: `/v1/blocks/${pageId}/children`,
    method: 'PATCH',
    body: { children: [emptySectionToggleBlock(section)] },
  });
  return created.results?.[0]?.id ?? pageId;
}

async function findSectionBlockId({ notionToken, pageId, section }) {
  let cursor = null;
  do {
    const query = cursor
      ? `?start_cursor=${encodeURIComponent(cursor)}&page_size=100`
      : '?page_size=100';
    const response = await notionRequest({
      notionToken,
      path: `/v1/blocks/${pageId}/children${query}`,
      method: 'GET',
    });
    const match = response.results?.find(
      (block) => blockText(block) === String(section) && blockSupportsChildren(block),
    );
    if (match) return match.id;
    cursor = response.has_more ? response.next_cursor : null;
  } while (cursor);
  return null;
}

function blockText(block) {
  const value = block[block.type]?.rich_text ?? [];
  return value.map((part) => part.plain_text ?? '').join('');
}

function blockSupportsChildren(block) {
  return ['toggle', 'column', 'column_list', 'synced_block', 'template'].includes(block.type);
}

function testSectionBlocks({
  attempts,
  git,
  syncSequence,
  title = `Test Case Planning Sync #${syncSequence}`,
}) {
  const planned = plannedTests(attempts);
  const approvals = testApprovals(attempts);
  const executed = executedTests(attempts);
  const summary = testSummary(attempts, git);
  if (
    planned.length === 0 &&
    approvals.length === 0 &&
    summary.total === 0 &&
    executed.length === 0
  )
    return [];

  const rows = numberedTestRows(summary.bullets);
  const unitRows = rows.filter((row) => row.type === 'Unit');
  const e2eRows = rows.filter((row) => row.type === 'E2E');

  const summaryRows = testSummaryRows(rows);
  return [
    heading(title, 3),
    paragraph('Test summary:'),
    ...summaryRows.map((row) =>
      bulleted(
        `${row.type}: total ${row.total}, new/modified ${row.newOrModified}, related ${row.related}`,
      ),
    ),
    paragraph('Unit tests:'),
    ...testDetailBullets(unitRows),
    paragraph('End-to-end tests:'),
    ...testDetailBullets(e2eRows),
    ...(approvals.length > 0
      ? [paragraph(`Approval: ${approvals.at(-1)}`)]
      : [paragraph('Approval: pending or not recorded.')]),
    ...(executed.length > 0 ? [paragraph(`Latest executed: ${executed.at(-1)}`)] : []),
  ];
}

function numberedTestRows(bullets) {
  const rows = [];
  let index = 1;
  for (const [type, items] of [
    ['Unit', bullets.unit],
    ['E2E', bullets.e2e],
  ]) {
    for (const item of items.slice(0, 12)) {
      rows.push({ number: index, type, ...formatTestDisplay(item) });
      index += 1;
    }
  }
  if (rows.length === 0)
    return [{ number: 1, type: 'Pending', test: 'No tests recorded yet.', indicator: 'Pending' }];
  return rows;
}

function formatTestDisplay(item) {
  const [indicator, rawPath] = String(item).includes(': ')
    ? String(item)
        .split(/: (.*)/s)
        .filter(Boolean)
    : ['Related', String(item)];
  const test = rawPath.split('/').filter(Boolean).at(-1) ?? rawPath;
  return { test, indicator };
}

function testSummary(attempts, git) {
  const buckets = {
    unit: emptyTestBucket('Unit'),
    integration: emptyTestBucket('Integration'),
    e2e: emptyTestBucket('End-to-end'),
  };

  for (const attempt of attempts) {
    const plan = attempt.testPlan;
    if (!plan) continue;
    addTestItems(buckets.unit, 'related', plan.unitTests);
    addTestItems(buckets.integration, 'related', plan.integrationTests);
    addTestItems(buckets.e2e, 'related', plan.e2eTests);
    addPlannedChangeItems(buckets, 'created', plan.testsToCreate);
    addPlannedChangeItems(buckets, 'updated', plan.testsToUpdate);
    addPlannedChangeItems(buckets, 'removed', plan.testsToRemove);
    addPlannedChangeItems(buckets, 'related', plan.existingTests);
    addPlannedChangeItems(buckets, 'related', plan.tests);
  }

  for (const file of changedTestFiles(git)) {
    addTestItems(classifyTestBucket(buckets, file), 'createdModified', [`New/Modified: ${file}`]);
  }

  const rows = Object.values(buckets).map((bucket) => ({
    type: bucket.label,
    created: bucket.created.size,
    updated: bucket.updated.size,
    createdModified: new Set([...bucket.created, ...bucket.updated, ...bucket.createdModified])
      .size,
    removed: bucket.removed.size,
    related: new Set([
      ...bucket.related,
      ...bucket.created,
      ...bucket.updated,
      ...bucket.createdModified,
      ...bucket.removed,
    ]).size,
  }));

  return {
    rows,
    total: rows.reduce((sum, row) => sum + row.related, 0),
    bullets: {
      unit: highLevelTestItems(buckets.unit),
      integration: highLevelTestItems(buckets.integration),
      e2e: highLevelTestItems(buckets.e2e),
    },
  };
}

function emptyTestBucket(label) {
  return {
    label,
    created: new Set(),
    updated: new Set(),
    createdModified: new Set(),
    removed: new Set(),
    related: new Set(),
  };
}

function addPlannedChangeItems(buckets, kind, items) {
  for (const item of items ?? []) addTestItems(classifyTestBucket(buckets, item), kind, [item]);
}

function addTestItems(bucket, kind, items) {
  for (const item of items ?? []) {
    const text = oneLine(item);
    if (text) bucket[kind].add(text);
  }
}

function classifyTestBucket(buckets, value) {
  const text = String(value ?? '').toLowerCase();
  if (/e2e|playwright|browser|current-capture|smoke|\.spec\./.test(text)) return buckets.e2e;
  if (/integration|api|route|server|mcp|database|db/.test(text)) return buckets.integration;
  return buckets.unit;
}

function highLevelTestItems(bucket) {
  return [
    ...new Set([
      ...[...bucket.created].map((item) => `New: ${item}`),
      ...[...bucket.updated].map((item) => `Modified: ${item}`),
      ...bucket.createdModified,
    ]),
  ];
}

function plannedTests(attempts) {
  return attempts
    .filter((attempt) => attempt.testPlan)
    .map((attempt) => {
      const plan = attempt.testPlan;
      const commands = plan.commands?.length ? ` Commands: ${plan.commands.join('; ')}` : '';
      const tests = formatTestPlanSummary(plan);
      return `${attempt.attemptId}: ${plan.scope ?? 'Test scope recorded.'} Approval: ${approvalStatusName(plan.testApprovalStatus)}.${tests}${commands}`;
    });
}

function formatTestPlanSummary(plan) {
  const parts = [];
  if (plan.existingTests?.length) parts.push(`Existing reviewed: ${plan.existingTests.join(', ')}`);
  if (plan.unitTests?.length) parts.push(`Unit: ${plan.unitTests.join(', ')}`);
  if (plan.integrationTests?.length) parts.push(`Integration: ${plan.integrationTests.join(', ')}`);
  if (plan.e2eTests?.length) parts.push(`E2E: ${plan.e2eTests.join(', ')}`);
  if (plan.testsToCreate?.length) parts.push(`Create: ${plan.testsToCreate.join(', ')}`);
  if (plan.testsToUpdate?.length) parts.push(`Update: ${plan.testsToUpdate.join(', ')}`);
  if (plan.testsToRemove?.length)
    parts.push(`Remove/out-of-scope: ${plan.testsToRemove.join(', ')}`);
  if (plan.leakCoverage?.length) parts.push(`Leak coverage: ${plan.leakCoverage.join(', ')}`);
  if (plan.testPriorities?.length) parts.push(`Priorities: ${plan.testPriorities.join(', ')}`);
  if (plan.testNonGoals?.length) parts.push(`Non-goals: ${plan.testNonGoals.join(', ')}`);
  if (plan.minimalTestPolicy?.principle) parts.push(`Policy: ${plan.minimalTestPolicy.principle}`);
  if (plan.tests?.length) parts.push(`Other: ${plan.tests.join(', ')}`);
  return parts.length ? ` ${parts.join(' | ')}` : '';
}

function testApprovals(attempts) {
  return attempts
    .filter((attempt) => attempt.testApproval)
    .map((attempt) => {
      const approval = attempt.testApproval;
      return `${attempt.attemptId}: ${approvalStatusName(approval.testApprovalStatus)} by ${approval.reviewer ?? 'unknown'} — ${approval.reason ?? 'no rationale'}`;
    });
}

function changedTestFiles(git) {
  const base = git.branch ? `origin/main...${git.branch}` : 'origin/main...HEAD';
  const child = spawnSync('git', ['diff', '--name-only', base], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (child.status !== 0) return [];
  return child.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => /(__tests__|\.test\.|\.spec\.|\/e2e\/)/.test(file));
}

function executedTests(attempts) {
  const entries = [];
  for (const attempt of attempts) {
    const compact = compactAttempt(attempt);
    addExecuted(entries, attempt.attemptId, 'Stage 3 platform test', compact.stage3PlatformTest);
    addExecuted(entries, attempt.attemptId, 'Current capture', compact.stage4);
    addExecuted(entries, attempt.attemptId, 'Validation', compact.stage8);
  }
  return entries;
}

function addExecuted(entries, attemptId, label, value) {
  if (!value || value === 'not-run') return;
  const result = value.result ?? 'unknown';
  const duration = value.durationMs ? ` in ${formatDuration(value.durationMs)}` : '';
  entries.push(`${attemptId}: ${label} ${result}${duration}`);
}

function detailBlocks({ activityId, activityUuid, attempts, git, syncedAt, syncSequence }) {
  return [
    heading(`Activity Sync #${syncSequence}: ${activityId}`),
    paragraph(`Activity UUID: ${activityUuid ?? 'not-set'}`),
    paragraph(`Last update: ${syncedAt}`),
    ...(args.timeline === true
      ? [heading('Activity Timeline Details', 3), ...timelineBlocks(attempts)]
      : []),
    ...(args.details === true
      ? [
          paragraph(
            `Git: ${git.branch ?? 'unknown'} @ ${git.head ?? 'unknown'} (${git.clean ? 'clean' : 'dirty'})`,
          ),
          paragraph(
            'Source artifacts are local and append-only. Each sync appends a compact progressive update.',
          ),
          ...attempts.map((attempt) => attemptBlock(attempt)),
        ]
      : []),
  ];
}

async function findActivityTimelineToggle({ notionToken, notionPageId }) {
  return findToggleByTitle({ notionToken, notionPageId, title: 'Activity Timeline' });
}

async function findToggleByTitle({ notionToken, notionPageId, title }) {
  let cursor = null;
  do {
    const query = cursor
      ? `?start_cursor=${encodeURIComponent(cursor)}&page_size=100`
      : '?page_size=100';
    const response = await notionRequest({
      notionToken,
      path: `/v1/blocks/${notionPageId}/children${query}`,
      method: 'GET',
    });
    const match = response.results?.find(
      (block) => block.type === 'toggle' && plainText(block.toggle?.rich_text) === title,
    );
    if (match) return match;
    cursor = response.has_more ? response.next_cursor : null;
  } while (cursor);
  return null;
}

function timelineToggleBlock(firstLine) {
  return {
    object: 'block',
    type: 'toggle',
    toggle: {
      rich_text: richText('Activity Timeline'),
      children: [bulleted(firstLine)],
    },
  };
}

function sectionToggleBlock(title, children = null) {
  return {
    object: 'block',
    type: 'toggle',
    toggle: {
      rich_text: richText(title),
      children: children?.length
        ? children
        : [paragraph(`No ${String(title).toLowerCase()} recorded yet.`)],
    },
  };
}

function emptySectionToggleBlock(title) {
  return {
    object: 'block',
    type: 'toggle',
    toggle: { rich_text: richText(title) },
  };
}

function formatTimelineTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return formatActivityTimestamp(date);
}

function activityProperties({ activityId, activityUuid, latest, git, syncedAt, existing }) {
  const activityCreatedAt = activityMetadata?.createdAt ?? syncedAt;
  return {
    'Activity ID': richTextProperty(activityId),
    'Activity UUID': richTextProperty(activityUuid ?? ''),
    Status: selectProperty(statusFromLatest(latest)),
    'Current Stage': richTextProperty(stageLabelFromLatest(latest)),
    'Approval Status': selectProperty(approvalStatusFromLatest(latest, existing)),
    Platforms: multiSelectProperty(latest?.platforms ?? []),
    Branch: richTextProperty(git.branch ?? ''),
    'Worktree Path': richTextProperty(git.worktreePath ?? ''),
    'Latest Attempt': richTextProperty(latest?.attemptId ?? ''),
    'Next Action': richTextProperty(latest?.nextAction ?? 'Review activity state.'),
    'Blocked By': richTextProperty(latest?.result === 'failed' ? 'Latest attempt failed' : ''),
    'Activity Created At': { date: { start: activityCreatedAt } },
    'Last Synced At': { date: { start: syncedAt } },
  };
}

function stageLabelFromLatest(latest) {
  if (!latest) return 'Intake';
  if (latest.stage === 'revision-assessment') {
    if (latest.routeTo === 'validation') return 'Validation';
    if (latest.routeTo === 'readiness') return 'Readiness';
    if (latest.routeTo === 'blocked') return 'Validation Verdict';
    return 'Implementation';
  }
  return STAGE_LABELS[latest.stage] ?? latest.stage ?? 'Intake';
}

function nextSyncSequence(attempts) {
  return attempts.filter((attempt) => attempt.notionSync).length + 1;
}

function latestAttemptSummary(attempts) {
  for (const attempt of [...attempts].reverse()) {
    const report = latestReportForAttempt(attempt);
    if (!report) continue;
    return {
      attemptId: attempt.attemptId,
      stage: report.stage,
      result: report.result,
      approvalStatus: report.approvalStatus,
      nextAction: report.nextAction,
      routeTo: report.routeTo,
      platforms:
        report.platforms ??
        report.nativeTargets?.map((target) => target.split(':')[0].replace('-device', '')) ??
        report.captures?.map((capture) => capture.platform) ??
        [],
    };
  }
  return null;
}

function lifecycleReportFromActivityRun(activityRun) {
  const child = activityRun?.execution?.childReport;
  const stage = child?.stage ?? activityRun?.lifecycleStage ?? activityRun?.decision?.nextStage;
  if (!stage) return null;
  return {
    stage,
    result: child?.result ?? activityRun.result,
    nextAction: child?.nextAction ?? activityRun.decision?.reason,
    routeTo: child?.routeTo,
    startedAt: activityRun.startedAt,
    finishedAt: activityRun.finishedAt,
    createdAt: activityRun.createdAt,
    durationMs: activityRun.durationMs,
  };
}

function latestStageContextReport(attemptDir) {
  const dir = resolve(attemptDir, 'stage-context');
  if (!existsSync(dir)) return null;
  return readdirSync(dir)
    .filter((name) => name.endsWith('-context.json'))
    .map((name) => readJsonIfExists(resolve(dir, name)))
    .filter(Boolean)
    .sort((a, b) => Date.parse(a.createdAt ?? '') - Date.parse(b.createdAt ?? ''))
    .at(-1);
}

function statusFromLatest(latest) {
  if (!latest) return 'Planned';
  if (latest.result === 'failed') return 'Blocked';
  if (latest.stage === 'test-case-planning') return 'Scoping';
  if (latest.stage === 'test-approval') return latest.result === 'passed' ? 'Scoping' : 'Blocked';
  if (latest.stage === 'capture-planning') return 'Scoping';
  if (latest.stage === 'activity-bootstrap') return 'Setup';
  if (latest.stage === 'stage-3-platform-test') return 'Setup';
  if (latest.stage === 'stage-3-readiness') return 'Setup';
  if (latest.stage === 'stage-context') return statusFromStageContext(latest);
  if (latest.stage === 'stage-4-current-capture') return 'Design Review';
  if (latest.stage === 'stage-4-browser-capture') return 'Design Review';
  if (latest.stage === 'stage-4-native-capture') return 'Design Review';
  if (latest.stage === 'android-platform-smoke') return 'Current Capture';
  if (latest.stage === 'approval') {
    return latest.result === 'passed' ? 'Approved For Build' : 'Design Review';
  }
  if (latest.stage === 'implementation') return 'Implementing';
  if (latest.stage === 'implementation-agent') return 'Implementing';
  if (latest.stage === 'implementation-complete') return 'Implementing';
  if (latest.stage === 'stage-8-validation') return 'Validating';
  if (latest.stage === 'validation-verdict')
    return latest.result === 'passed' ? 'PR Open' : 'Blocked';
  if (latest.stage === 'revision-assessment') {
    if (latest.routeTo === 'implementation') return 'Implementing';
    if (latest.routeTo === 'validation') return 'Validating';
    if (latest.routeTo === 'readiness') return 'Setup';
    return 'Blocked';
  }
  return 'Planned';
}

function statusFromStageContext(latest) {
  switch (latest.requestedStage) {
    case 'scoping':
      return 'Scoping';
    case 'setup':
      return 'Setup';
    case 'readiness':
      return 'Setup';
    case 'current-capture':
    case 'design-approval-gate':
      return 'Design Review';
    case 'implementation':
      return 'Implementing';
    case 'validation':
    case 'validation-verdict':
      return 'Validating';
    case 'pr-handoff':
      return 'PR Open';
    case 'final-sync-close':
      return 'Merged';
    default:
      return 'Planned';
  }
}

function approvalStatusFromLatest(latest, existing = null) {
  if (!latest) return 'Not Needed';
  if (latest.result === 'failed') return 'Needs Revision';
  if (latest.stage === 'test-case-planning') return approvalStatusName(latest.testApprovalStatus);
  if (latest.stage === 'test-approval') return approvalStatusName(latest.testApprovalStatus);
  if (
    latest.stage === 'stage-4-current-capture' ||
    latest.stage === 'stage-4-browser-capture' ||
    latest.stage === 'stage-4-native-capture'
  ) {
    return preserveManualApproval(existing) ?? 'Pending';
  }
  if (latest.stage === 'approval') return approvalStatusName(latest.approvalStatus);
  if (latest.stage === 'implementation') return 'Approved';
  if (latest.stage === 'implementation-agent') return 'Approved';
  if (latest.stage === 'implementation-complete') return 'Approved';
  if (latest.stage === 'stage-8-validation') {
    if (latest.result === 'passed') return 'Approved';
    return preserveManualApproval(existing) ?? 'Approved';
  }
  if (latest.stage === 'validation-verdict') {
    return latest.result === 'passed' ? 'Approved' : 'Needs Revision';
  }
  if (latest.stage === 'revision-assessment') {
    return latest.result === 'passed' ? 'Approved' : 'Needs Revision';
  }
  return 'Not Needed';
}

function timelineBlocks(attempts) {
  const rows = attempts.flatMap((attempt) => {
    const compact = compactAttempt(attempt);
    return [
      ['Bootstrap', compact.bootstrap],
      [
        'Readiness',
        compact.stage3PlatformTest !== 'not-run' ? compact.stage3PlatformTest : compact.stage3,
      ],
      ['Current Capture', compact.stage4],
      ['Design Approval Gate', compact.approval],
      ['Implementation', compact.implementation],
      ['Implementation Agent', compact.implementationAgent],
      ['Validation', compact.stage8],
      ['Validation Verdict', compact.validationVerdict],
      ['Revision Assessment', compact.revisionAssessment],
      ['Notion Sync', compact.notionSync],
    ]
      .filter(([, value]) => value && value !== 'not-run')
      .map(([label, value]) => ({ attemptId: attempt.attemptId, label, value }));
  });

  if (rows.length === 0) return [bulleted('No stage reports recorded yet.')];

  return rows
    .slice(-20)
    .map(({ attemptId, label, value }) =>
      bulleted(
        `${attemptId} · ${label} · ${value.result ?? 'unknown'}${formatStageTiming(value)}${value.nextAction ? ` · ${value.nextAction}` : ''}`,
      ),
    );
}

function formatStageTiming(value) {
  const parts = [];
  if (value.startedAt) parts.push(`start ${formatActivityTimestamp(value.startedAt)}`);
  if (value.finishedAt) parts.push(`end ${formatActivityTimestamp(value.finishedAt)}`);
  if (Number.isFinite(value.durationMs)) parts.push(`took ${formatDuration(value.durationMs)}`);
  return parts.length > 0 ? ` · ${parts.join(' · ')}` : '';
}

function formatDuration(durationMs) {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function attemptBlock(attempt) {
  return codeBlock(JSON.stringify(compactAttempt(attempt), null, 2));
}

function compactAttempt(attempt) {
  return {
    attemptId: attempt.attemptId,
    bootstrap: summarize(attempt.bootstrap),
    stage3: summarize(attempt.stage3),
    stage3PlatformTest: summarize(attempt.stage3PlatformTest),
    stage4: summarize(attempt.stage4),
    stage4Native: summarize(attempt.stage4Native),
    androidPlatformSmoke: summarize(attempt.androidPlatformSmoke),
    testPlan: summarizeTestPlan(attempt.testPlan),
    testApproval: summarizeTestApproval(attempt.testApproval),
    approval: summarize(attempt.approval),
    implementation: summarize(attempt.implementation),
    implementationAgent: summarize(attempt.implementationAgent),
    stage8: summarize(attempt.stage8),
    validationVerdict: summarize(attempt.validationVerdict),
    revisionAssessment: summarize(attempt.revisionAssessment),
    activityRun: summarize(lifecycleReportFromActivityRun(attempt.activityRun)),
    stageContext: summarize(attempt.stageContext),
    notionSync: summarizeSync(attempt.notionSync),
  };
}

function summarizeTestPlan(report) {
  if (!report) return 'not-run';
  return {
    stage: report.stage,
    result: report.result,
    approval: approvalStatusName(report.testApprovalStatus),
    scope: report.scope,
    tests: report.tests,
    unitTests: report.unitTests,
    integrationTests: report.integrationTests,
    e2eTests: report.e2eTests,
    existingTests: report.existingTests,
    testsToCreate: report.testsToCreate,
    testsToUpdate: report.testsToUpdate,
    testsToRemove: report.testsToRemove,
    commands: report.commands,
    nextAction: report.nextAction,
    artifactDir: report.artifactDir,
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
    durationMs: report.durationMs,
  };
}

function summarizeTestApproval(report) {
  if (!report) return 'not-run';
  return {
    stage: report.stage,
    result: report.result,
    approval: approvalStatusName(report.testApprovalStatus),
    reviewer: report.reviewer,
    reason: report.reason,
    nextAction: report.nextAction,
    artifactDir: report.artifactDir,
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
    durationMs: report.durationMs,
  };
}

function summarize(report) {
  if (!report) return 'not-run';
  return {
    stage: report.stage,
    result: report.result,
    nextAction: report.nextAction,
    routeTo: report.routeTo,
    failureType: report.failureType,
    loopCount: report.loopCount,
    maxLoops: report.maxLoops,
    artifactDir: report.artifactDir,
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
    durationMs: report.durationMs,
  };
}

function summarizeSync(report) {
  if (!report) return 'not-run';
  return {
    stage: report.stage,
    result: report.result,
    mode: report.mode,
    syncSequence: report.syncSequence,
    syncedAt: report.syncedAt,
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
    durationMs: report.durationMs,
    notionActivityPageUrl: report.notionActivityPageUrl,
  };
}

function resolveAgentSummary({ latest, agent, syncedAt }) {
  const explicit = args.summary ?? process.env.OPENREAD_ACTIVITY_SUMMARY;
  const stage = stageLabelFromLatest(latest);
  const result = latest?.result ?? 'pending';
  const timing = formatStageTiming(latest ?? {});
  const summary =
    explicit ?? `${stage} ${result}${timing}; next: ${latest?.nextAction ?? 'review state'}`;
  return oneLine(`${formatTimelineTime(syncedAt)}: ${agent}: ${summary}`);
}

function oneLine(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

function preserveManualApproval(page) {
  const value = page?.properties?.['Approval Status']?.select?.name ?? '';
  return ['Approved', 'Not Needed'].includes(value) ? value : null;
}

function approvalStatusName(value) {
  if (value === 'approved') return 'Approved';
  if (value === 'rejected') return 'Rejected';
  if (value === 'needs-revision') return 'Needs Revision';
  if (value === 'pending') return 'Pending';
  return 'Not Needed';
}

function printHelp() {
  console.log(`Activity Notion sync

Usage:
  pnpm activity:notion-sync --activity <id> --attempt <id> [options]

Options:
  --write                  Create/update the Activity Log page in Notion
  --database <id>          Activity Log database ID
  --notion-page <id>       Parent/root Notion page ID fallback
  --artifact-root <path>   Activity artifact root
  --summary <text>         One-line append-only activity history summary
  --no-event               Update Activity properties/pickup context without appending timeline/event rows
  --timeline               Also append compact timeline bullets
  --details                Also append compact JSON attempt details

Behavior:
  Dry-runs by default. Write mode appends one bullet under a single Activity Timeline
  toggle unless --timeline or --details is explicitly provided.
`);
}

function gitSummary() {
  return {
    branch: runGit(['branch', '--show-current']),
    head: runGit(['rev-parse', '--short', 'HEAD']),
    clean: runGit(['status', '--short']) === '',
    worktreePath: runGit(['rev-parse', '--show-toplevel']),
  };
}

function runGit(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

async function notionRequest({ notionToken, path, method, body }) {
  const res = await fetch(`https://api.notion.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${notionToken}`,
      'Content-Type': 'application/json',
      'Notion-Version': NOTION_API_VERSION,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion request failed: ${method} ${path} ${res.status} ${text}`);
  }

  return res.json();
}

function heading(text, level = 2) {
  return {
    object: 'block',
    type: `heading_${level}`,
    [`heading_${level}`]: { rich_text: richText(text) },
  };
}

function paragraph(text) {
  return { object: 'block', type: 'paragraph', paragraph: { rich_text: richText(text) } };
}

function bulleted(text) {
  return {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: { rich_text: richText(String(text).slice(0, 1_900)) },
  };
}

function codeBlock(text) {
  return {
    object: 'block',
    type: 'code',
    code: { language: 'json', rich_text: richText(text.slice(0, 1_900)) },
  };
}

function testSummaryRows(rows) {
  return ['Unit', 'E2E'].map((type) => {
    const typeRows = rows.filter((row) => row.type === type);
    return {
      type,
      total: typeRows.length,
      newOrModified: typeRows.filter((row) => /new|modified/i.test(row.indicator)).length,
      related: typeRows.filter((row) => !/new|modified/i.test(row.indicator)).length,
    };
  });
}

function testDetailBullets(rows) {
  const displayRows = rows.length
    ? rows
    : [{ number: '-', test: 'No tests recorded yet.', indicator: 'Pending' }];
  return displayRows.map((row) => bulleted(`${row.number}. ${row.test} — ${row.indicator}`));
}

function titleProperty(content) {
  return { title: richText(content) };
}

function richTextProperty(content) {
  return { rich_text: richText(String(content ?? '').slice(0, 1_900)) };
}

function selectProperty(name) {
  return { select: { name } };
}

function option(name, color) {
  return { name, color };
}

function normalizeNotionId(value) {
  return String(value).replace(/-/g, '').trim();
}

function multiSelectProperty(names) {
  return { multi_select: [...new Set(names.filter(Boolean))].map((name) => ({ name })) };
}

function richText(content) {
  return [{ type: 'text', text: { content } }];
}

function plainText(richTextParts) {
  return richTextParts?.map((part) => part.plain_text).join('') ?? '';
}

function plainTitle(property) {
  return property?.title?.map((part) => part.plain_text).join('') ?? '';
}

function richTextValue(property) {
  return property?.rich_text?.map((part) => part.plain_text).join('') ?? '';
}

function dateOnly(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function isDateScopedTitle(value) {
  return /^\d{4}-\d{2}-\d{2} #\d+$/.test(String(value));
}

function dateFromTitle(value) {
  return String(value).slice(0, 10);
}

function sequenceFromTitle(value) {
  return Number(String(value).match(/#(\d+)$/)?.[1]);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
