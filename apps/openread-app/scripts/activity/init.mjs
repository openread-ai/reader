#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { ensureDir, parseArgs, readJsonIfExists, writeJson } from './common.mjs';

const args = parseArgs(process.argv.slice(2));
const startedAtMs = Date.now();
const title = String(args.title ?? args.intent ?? args.slug ?? 'Untitled Activity').trim();
const slug = sanitizeSlug(args.slug ?? title);
const artifactRoot = resolve(
  args.artifactRoot ??
    process.env.OPENREAD_ACTIVITY_ARTIFACT_ROOT ??
    resolve(homedir(), '.openread-dev/activity-artifacts'),
);
const registryPath = resolve(artifactRoot, 'activity-registry.json');
const registry = readJsonIfExists(registryPath) ?? { schemaVersion: 1, activities: [] };
const activityId = args.activity ?? nextActivityId(registry.activities, slug);
const activityDir = resolve(artifactRoot, activityId);
const metadataPath = resolve(activityDir, 'activity.json');

if (existsSync(metadataPath) && args.force !== true) {
  const existing = readJsonIfExists(metadataPath);
  console.log(
    JSON.stringify(
      { result: 'existing', ...existing, durationMs: Date.now() - startedAtMs },
      null,
      2,
    ),
  );
  process.exit(0);
}

const now = new Date().toISOString();
const metadata = {
  schemaVersion: 1,
  activityId,
  activityUuid: args.activityUuid ?? randomUUID(),
  title,
  slug,
  status: 'planned',
  currentStage: 'intake',
  approvalStatus: 'not-needed',
  artifactDir: activityDir,
  createdAt: now,
  updatedAt: now,
};

ensureDir(activityDir);
writeJson(metadataPath, metadata);

const nextRegistry = {
  ...registry,
  activities: [
    ...registry.activities.filter((activity) => activity.activityId !== activityId),
    {
      activityId,
      activityUuid: metadata.activityUuid,
      title,
      slug,
      artifactDir: activityDir,
      createdAt: now,
    },
  ].sort((a, b) => a.activityId.localeCompare(b.activityId)),
};
writeJson(registryPath, nextRegistry);

console.log(
  JSON.stringify({ result: 'created', ...metadata, durationMs: Date.now() - startedAtMs }, null, 2),
);

function nextActivityId(activities) {
  const sequence = activities
    .map((activity) => activity.activityId)
    .map((id) => String(id ?? '').match(/^ACT-(\d+)$/)?.[1])
    .filter(Boolean)
    .map((id) => Number(id))
    .filter(Number.isFinite)
    .reduce((max, value) => Math.max(max, value), 0);

  return `ACT-${String(sequence + 1).padStart(3, '0')}`;
}

function sanitizeSlug(value) {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
