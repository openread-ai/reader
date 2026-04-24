#!/usr/bin/env node
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  getActivityConfig,
  loadActivityEnv,
  parseArgs,
  readJsonIfExists,
  writeJson,
} from './common.mjs';

const DEFAULT_NOTION_TARGET = '34c159c7f71980b99fdbf952588a4f50';
const NOTION_API_VERSION = '2022-06-28';
const STAGE_LABELS = {
  'capture-planning': 'Scoping',
  'activity-bootstrap': 'Setup',
  'stage-3-readiness': 'Readiness',
  'stage-3-platform-test': 'Readiness',
  'android-platform-smoke': 'Readiness',
  'stage-4-current-capture': 'Current Capture',
  'stage-4-browser-capture': 'Current Capture',
  'stage-4-native-capture': 'Current Capture',
  approval: 'Design Approval',
  implementation: 'Implementation',
  'stage-8-validation': 'Validation',
  'validation-verdict': 'Validation Verdict',
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
const agentSummary = resolveAgentSummary({ latest, git });
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

const eventPage = await createActivityEvent({
  notionToken,
  databaseId: activityEventsDatabase.id,
  activityPageId: activityPage.id,
  activityId: config.activityId,
  activityUuid: config.activityUuid,
  attemptId: config.attemptId,
  latest,
  syncedAt,
  agentSummary,
});

const response = await appendActivitySummary({
  notionToken,
  notionPageId: activityPage.id,
  activityId: config.activityId,
  activityUuid: config.activityUuid,
  attempts,
  git,
  syncedAt,
  syncSequence,
  agentSummary,
});

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
  activityEventPageId: eventPage.id,
  activityEventPageUrl: eventPage.url,
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
    activityEventPageId: eventPage.id,
    activityEventPageUrl: eventPage.url,
    status: statusFromLatest(latest),
    currentStage: stageLabelFromLatest(latest),
    approvalStatus: approvalStatusFromLatest(latest),
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
        approval: readJsonIfExists(resolve(attemptDir, 'approval/approval-report.json')),
        implementation: readJsonIfExists(
          resolve(attemptDir, 'implementation/implementation-report.json'),
        ),
        stage8: readJsonIfExists(resolve(attemptDir, 'stage-8-validation/validation-report.json')),
        validationVerdict: readJsonIfExists(
          resolve(attemptDir, 'stage-8-validation/validation-verdict.json'),
        ),
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
  return (
    attempt.validationVerdict ??
    attempt.stage8 ??
    attempt.implementation ??
    attempt.approval ??
    attempt.stage4Native ??
    attempt.stage4 ??
    attempt.stage3PlatformTest ??
    attempt.androidPlatformSmoke ??
    attempt.stage3 ??
    attempt.bootstrap ??
    attempt.notionSync
  );
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
  const agent = oneLine(args.agent ?? process.env.OPENREAD_ACTIVITY_AGENT ?? 'Chat');
  const stage = stageLabelFromLatest(latest);
  const result = latest?.result ?? 'unknown';
  return notionRequest({
    notionToken,
    path: '/v1/pages',
    method: 'POST',
    body: {
      parent: { database_id: databaseId },
      properties: {
        Title: titleProperty(`${formatTimelineTime(syncedAt)} — ${agent}`),
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
    ...activityProperties({ activityId, activityUuid, latest, git, syncedAt }),
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
      children: [
        heading('Scope'),
        paragraph('Created by Openread activity workflow sync.'),
        heading('Stage History'),
        heading('Attempts'),
        heading('Artifacts'),
        heading('Design Approvals'),
        heading('Validation Results'),
        heading('Decisions'),
        heading('Handoff Notes'),
      ],
    },
  });
  return { ...page, ...titleState };
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
  const timelineLine = `${formatTimelineTime(syncedAt)} — ${agentSummary}`;
  const timelineToggle = await findActivityTimelineToggle({ notionToken, notionPageId });
  if (timelineToggle) {
    const response = await notionRequest({
      notionToken,
      path: `/v1/blocks/${timelineToggle.id}/children`,
      method: 'PATCH',
      body: { children: [bulleted(timelineLine)] },
    });
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

  return notionRequest({
    notionToken,
    path: `/v1/blocks/${notionPageId}/children`,
    method: 'PATCH',
    body: { children: blocks.slice(0, 100) },
  });
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
  return notionRequest({
    notionToken,
    path: `/v1/blocks/${notionPageId}/children`,
    method: 'PATCH',
    body: {
      children: detailBlocks({ activityId, activityUuid, attempts, git, syncedAt, syncSequence }),
    },
  });
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
      (block) =>
        block.type === 'toggle' && plainText(block.toggle?.rich_text) === 'Activity Timeline',
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

function formatTimelineTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().replace('T', ' ').slice(0, 16);
}

function activityProperties({ activityId, activityUuid, latest, syncedAt }) {
  return {
    'Activity ID': richTextProperty(activityId),
    'Activity UUID': richTextProperty(activityUuid ?? ''),
    Status: selectProperty(statusFromLatest(latest)),
    'Current Stage': richTextProperty(stageLabelFromLatest(latest)),
    'Approval Status': selectProperty(approvalStatusFromLatest(latest)),
    Platforms: multiSelectProperty(latest?.platforms ?? []),
    'Latest Attempt': richTextProperty(latest?.attemptId ?? ''),
    'Next Action': richTextProperty(latest?.nextAction ?? 'Review activity state.'),
    'Blocked By': richTextProperty(latest?.result === 'failed' ? 'Latest attempt failed' : ''),
    'Last Synced At': { date: { start: syncedAt } },
  };
}

function stageLabelFromLatest(latest) {
  if (!latest) return 'Intake';
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
      platforms:
        report.platforms ??
        report.nativeTargets?.map((target) => target.split(':')[0].replace('-device', '')) ??
        report.captures?.map((capture) => capture.platform) ??
        [],
    };
  }
  return null;
}

function statusFromLatest(latest) {
  if (!latest) return 'Planned';
  if (latest.result === 'failed') return 'Blocked';
  if (latest.stage === 'capture-planning') return 'Scoping';
  if (latest.stage === 'activity-bootstrap') return 'Setup';
  if (latest.stage === 'stage-3-platform-test') return 'Setup';
  if (latest.stage === 'stage-3-readiness') return 'Setup';
  if (latest.stage === 'stage-4-current-capture') return 'Design Review';
  if (latest.stage === 'stage-4-browser-capture') return 'Design Review';
  if (latest.stage === 'stage-4-native-capture') return 'Design Review';
  if (latest.stage === 'android-platform-smoke') return 'Current Capture';
  if (latest.stage === 'approval') {
    return latest.result === 'passed' ? 'Approved For Build' : 'Design Review';
  }
  if (latest.stage === 'implementation') return 'Implementing';
  if (latest.stage === 'stage-8-validation') return 'Validating';
  if (latest.stage === 'validation-verdict')
    return latest.result === 'passed' ? 'PR Open' : 'Blocked';
  return 'Planned';
}

function approvalStatusFromLatest(latest) {
  if (!latest) return 'Not Needed';
  if (latest.result === 'failed') return 'Needs Revision';
  if (
    latest.stage === 'stage-4-current-capture' ||
    latest.stage === 'stage-4-browser-capture' ||
    latest.stage === 'stage-4-native-capture'
  ) {
    return 'Pending';
  }
  if (latest.stage === 'approval') return approvalStatusName(latest.approvalStatus);
  if (latest.stage === 'implementation') return 'Approved';
  if (latest.stage === 'stage-8-validation') {
    return latest.result === 'passed' ? 'Approved' : 'Pending';
  }
  if (latest.stage === 'validation-verdict') {
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
      ['Design Approval', compact.approval],
      ['Implementation', compact.implementation],
      ['Validation', compact.stage8],
      ['Validation Verdict', compact.validationVerdict],
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
        `${attemptId} · ${label} · ${value.result ?? 'unknown'}${value.durationMs ? ` · ${value.durationMs}ms` : ''}${value.nextAction ? ` · ${value.nextAction}` : ''}`,
      ),
    );
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
    approval: summarize(attempt.approval),
    implementation: summarize(attempt.implementation),
    stage8: summarize(attempt.stage8),
    validationVerdict: summarize(attempt.validationVerdict),
    notionSync: summarizeSync(attempt.notionSync),
  };
}

function summarize(report) {
  if (!report) return 'not-run';
  return {
    stage: report.stage,
    result: report.result,
    nextAction: report.nextAction,
    artifactDir: report.artifactDir,
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
    notionActivityPageUrl: report.notionActivityPageUrl,
  };
}

function resolveAgentSummary({ latest, git }) {
  const explicit = args.summary ?? process.env.OPENREAD_ACTIVITY_SUMMARY;
  if (explicit) return oneLine(explicit);

  const stage = stageLabelFromLatest(latest);
  const result = latest?.result ?? 'pending';
  const next = latest?.nextAction ?? 'Review activity state.';
  const branch = git.branch ?? 'unknown-branch';
  return oneLine(
    `Agent synced ${stage} (${result}) from ${branch}; observed this activity to decide next action: ${next}`,
  );
}

function oneLine(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

function approvalStatusName(value) {
  if (value === 'approved') return 'Approved';
  if (value === 'rejected') return 'Rejected';
  if (value === 'needs-revision') return 'Needs Revision';
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
