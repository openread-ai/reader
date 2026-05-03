#!/usr/bin/env node
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { ensureDir, parseArgs, writeJson } from './common.mjs';

const DEFAULT_OPENREAD_ROOT_PAGE = '34c159c7f71980b99fdbf952588a4f50';
const NOTION_API_VERSION = '2022-06-28';

const args = parseArgs(process.argv.slice(2));
const parentPageId = normalizeNotionId(
  args.parentPage ?? process.env.OPENREAD_NOTION_ROOT_PAGE ?? DEFAULT_OPENREAD_ROOT_PAGE,
);
const artifactRoot = resolve(
  args.artifactRoot ??
    process.env.OPENREAD_ACTIVITY_ARTIFACT_ROOT ??
    resolve(homedir(), '.openread-dev/activity-artifacts'),
);
const notionToken = process.env.NOTION_TOKEN ?? process.env.NOTION_API_KEY;

if (!notionToken) {
  fail('NOTION_TOKEN or NOTION_API_KEY is required to create the Activity Log database.');
}

const response = await fetch('https://api.notion.com/v1/databases', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${notionToken}`,
    'Content-Type': 'application/json',
    'Notion-Version': NOTION_API_VERSION,
  },
  body: JSON.stringify({
    parent: { type: 'page_id', page_id: parentPageId },
    title: [{ type: 'text', text: { content: 'Activity Log' } }],
    properties: {
      Title: { title: {} },
      'Activity ID': { rich_text: {} },
      'Activity UUID': { rich_text: {} },
      Status: {
        select: {
          options: [
            option('Planned', 'gray'),
            option('Scoping', 'blue'),
            option('Setup', 'yellow'),
            option('Current Capture', 'orange'),
            option('Design Review', 'purple'),
            option('Approved For Build', 'green'),
            option('Implementing', 'blue'),
            option('Validating', 'orange'),
            option('Blocked', 'red'),
            option('PR Open', 'green'),
            option('Merged', 'green'),
            option('Cancelled', 'gray'),
          ],
        },
      },
      'Current Stage': { rich_text: {} },
      'Approval Status': {
        select: {
          options: [
            option('Not Needed', 'gray'),
            option('Pending', 'yellow'),
            option('Approved', 'green'),
            option('Rejected', 'red'),
            option('Needs Revision', 'orange'),
          ],
        },
      },
      Platforms: { multi_select: {} },
      'Latest Attempt': { rich_text: {} },
      'Next Action': { rich_text: {} },
      'Blocked By': { rich_text: {} },
      Branch: { rich_text: {} },
      'Worktree Path': { rich_text: {} },
      'PR URL': { url: {} },
      'Activity Progress History': { rich_text: {} },
      'Activity Created At': { date: {} },
      'Last Synced At': { date: {} },
    },
  }),
});

if (!response.ok) {
  const body = await response.text();
  fail(`Failed to create Activity Log database: ${response.status} ${body}`);
}

const database = await response.json();
const config = {
  schemaVersion: 1,
  notionRootPageId: parentPageId,
  activityLogDatabaseId: database.id,
  activityLogUrl: database.url,
  createdAt: new Date().toISOString(),
};

ensureDir(artifactRoot);
writeJson(resolve(artifactRoot, 'notion-activity-log.json'), config);
console.log(JSON.stringify({ result: 'created', ...config }, null, 2));

function option(name, color) {
  return { name, color };
}

function normalizeNotionId(value) {
  return String(value).replace(/-/g, '').trim();
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
