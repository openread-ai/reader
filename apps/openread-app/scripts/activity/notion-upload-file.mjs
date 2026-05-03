#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs';
import { basename, extname, relative, resolve } from 'node:path';
import { ensureDir, getActivityConfig, loadActivityEnv, parseArgs, writeJson } from './common.mjs';

const NOTION_FILE_UPLOAD_VERSION = '2026-03-11';
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
const artifactDir = resolve(config.attemptDir, 'notion-file-upload');
const notionToken = process.env.NOTION_TOKEN ?? process.env.NOTION_API_KEY;
const filePaths = resolveFilePaths(args);

ensureDir(artifactDir);

if (filePaths.length === 0) fail('--file or --files is required');

const files = filePaths.map((filePath, index) => {
  assertUploadPathAllowed(filePath);
  return {
    filePath,
    filename: filenameFor(filePath, index),
    contentType: String(args.contentType ?? inferContentType(filePath)),
    stat: statSync(filePath),
  };
});

if (!notionToken) {
  const report = baseReport({
    result: String(args.requireToken ?? 'false') === 'true' ? 'failed' : 'partial',
    mode: 'no-token',
    files: files.map(fileSummary),
    nextAction: 'Set NOTION_TOKEN or NOTION_API_KEY to create and send Notion File Uploads.',
  });
  writeJson(resolve(artifactDir, 'notion-file-upload-report.json'), report);
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.result === 'failed' ? 1 : 0);
}

if (args.textOnly === true) {
  if (!args.page) fail('--page is required with --text-only');
  const attached = await appendTextPreviews({
    notionToken,
    pageId: String(args.page),
    files,
    heading: args.heading,
    section: args.section,
  });
  const report = baseReport({
    result: 'passed',
    mode: 'text-only-attached',
    files: files.map(fileSummary),
    attachedBlockId: attached?.id ?? null,
    attachedSectionBlockId: attached?.sectionBlockId ?? null,
    notionPageId: args.page ?? null,
    nextAction: 'Verify rendered metadata preview on the Activity Log page.',
  });
  writeJson(resolve(artifactDir, 'notion-file-upload-report.json'), report);
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const uploads = [];
for (const file of files) {
  uploads.push({ ...file, sent: await uploadFile(file) });
}

const attached =
  args.page && uploads.every((upload) => upload.sent.status === 'uploaded')
    ? await appendUploads({
        notionToken,
        pageId: String(args.page),
        uploads,
        layout: String(args.layout ?? (uploads.length > 1 ? 'columns' : 'single')),
        caption: args.caption,
        heading: args.heading,
        section: args.section,
      })
    : null;

const allUploaded = uploads.every((upload) => upload.sent.status === 'uploaded');
const report = baseReport({
  result: allUploaded ? 'passed' : 'partial',
  mode: attached ? `uploaded-and-attached-${attached.layout}` : 'uploaded',
  files: uploads.map((upload) => ({
    ...fileSummary(upload),
    fileUpload: fileUploadSummary(upload.sent),
  })),
  attachedBlockId: attached?.id ?? null,
  attachedSectionBlockId: attached?.sectionBlockId ?? null,
  attachedLayout: attached?.layout ?? null,
  notionPageId: args.page ?? null,
  nextAction: attached
    ? 'Verify uploaded evidence blocks on the Activity Log page.'
    : allUploaded
      ? 'Attach the file_upload IDs to an Activity Log page block or file property.'
      : 'Inspect Notion File Upload status before attaching.',
});

writeJson(resolve(artifactDir, 'notion-file-upload-report.json'), report);
console.log(JSON.stringify(report, null, 2));
process.exit(report.result === 'failed' ? 1 : 0);

function baseReport(extra) {
  return {
    schemaVersion: 1,
    stage: 'notion-file-upload',
    activityId: config.activityId,
    activityUuid: config.activityUuid,
    attemptId: config.attemptId,
    artifactDir,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAtMs,
    createdAt: startedAt,
    ...extra,
  };
}

function resolveFilePaths(parsedArgs) {
  const values = [];
  if (parsedArgs.file) values.push(String(parsedArgs.file));
  if (parsedArgs.files) values.push(...String(parsedArgs.files).split(','));
  return values.map((value) => resolve(value.trim())).filter(Boolean);
}

function assertUploadPathAllowed(filePath) {
  if (args.allowOutsideArtifacts === true) return;
  const relativePath = relative(config.artifactRoot, filePath);
  if (relativePath && !relativePath.startsWith('..') && !relativePath.startsWith('/')) return;
  fail(
    `Refusing to upload file outside activity artifact root: ${filePath}. Pass --allow-outside-artifacts to override.`,
  );
}

function filenameFor(filePath, index) {
  if (!args.filename) return basename(filePath);
  const names = String(args.filename)
    .split(',')
    .map((value) => value.trim());
  return names[index] || names[0] || basename(filePath);
}

function fileSummary(file) {
  return {
    sourcePath: file.filePath,
    filename: file.filename,
    contentType: file.contentType,
    contentLength: file.stat.size,
  };
}

function fileUploadSummary(sent) {
  return {
    id: sent.id,
    status: sent.status,
    filename: sent.filename,
    contentType: sent.content_type,
    contentLength: sent.content_length,
    expiryTime: sent.expiry_time,
  };
}

async function uploadFile(file) {
  const created = await notionRequest({
    notionToken,
    path: '/v1/file_uploads',
    method: 'POST',
    body: {
      mode: 'single_part',
      filename: file.filename,
      content_type: file.contentType,
    },
  });

  const formData = new FormData();
  formData.append(
    'file',
    new Blob([readFileSync(file.filePath)], { type: file.contentType }),
    file.filename,
  );

  return notionFormRequest({
    notionToken,
    path: `/v1/file_uploads/${created.id}/send`,
    method: 'POST',
    body: formData,
  });
}

async function notionRequest({ notionToken, path, method, body }) {
  const res = await fetch(`https://api.notion.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${notionToken}`,
      'Content-Type': 'application/json',
      'Notion-Version': NOTION_FILE_UPLOAD_VERSION,
    },
    body: JSON.stringify(body),
  });

  return parseNotionResponse(res, method, path);
}

async function appendTextPreviews({ notionToken, pageId, files, heading, section }) {
  const children = [];
  if (heading) children.push(headingBlock(String(heading)));
  children.push(...files.flatMap((file) => textPreviewBlocks(file)));

  const targetBlockId = section
    ? await findOrCreateSectionBlockId({ notionToken, pageId, section })
    : null;
  const res = await notionRequest({
    notionToken,
    path: `/v1/blocks/${targetBlockId ?? pageId}/children`,
    method: 'PATCH',
    body: { children },
  });

  return { id: res.results?.[0]?.id ?? null, sectionBlockId: targetBlockId ?? pageId };
}

async function appendUploads({ notionToken, pageId, uploads, layout, caption, heading, section }) {
  const children = [];
  if (heading) children.push(headingBlock(String(heading)));

  if (layout === 'columns' && uploads.length > 1) {
    children.push({
      object: 'block',
      type: 'column_list',
      column_list: {
        children: uploads.map((upload, index) => ({
          object: 'block',
          type: 'column',
          column: {
            children: [uploadBlock(upload, captionFor({ caption, upload, index }))],
          },
        })),
      },
    });
  } else {
    children.push(
      ...uploads.map((upload, index) =>
        uploadBlock(upload, captionFor({ caption, upload, index })),
      ),
    );
  }

  if (args.renderText === true) {
    children.push(...uploads.flatMap((upload) => textPreviewBlocks(upload)));
  }

  const targetBlockId = section
    ? await findOrCreateSectionBlockId({ notionToken, pageId, section })
    : null;
  const res = await notionRequest({
    notionToken,
    path: `/v1/blocks/${targetBlockId ?? pageId}/children`,
    method: 'PATCH',
    body: { children },
  });

  return { id: res.results?.[0]?.id ?? null, layout, sectionBlockId: targetBlockId ?? pageId };
}

async function findOrCreateSectionBlockId({ notionToken, pageId, section }) {
  const existing = await findSectionBlockId({ notionToken, pageId, section });
  if (existing) return existing;

  const created = await notionRequest({
    notionToken,
    path: `/v1/blocks/${pageId}/children`,
    method: 'PATCH',
    body: { children: [sectionToggleBlock(String(section))] },
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

function uploadBlock(upload, caption) {
  const isImage = upload.contentType.startsWith('image/');
  const type = isImage ? 'image' : 'file';
  return {
    object: 'block',
    type,
    [type]: {
      type: 'file_upload',
      file_upload: { id: upload.sent.id },
      caption: [{ type: 'text', text: { content: String(caption).slice(0, 1_900) } }],
    },
  };
}

function headingBlock(text) {
  return {
    object: 'block',
    type: 'heading_3',
    heading_3: { rich_text: [{ type: 'text', text: { content: text.slice(0, 1_900) } }] },
  };
}

function sectionToggleBlock(text) {
  return {
    object: 'block',
    type: 'toggle',
    toggle: {
      rich_text: [{ type: 'text', text: { content: text.slice(0, 1_900) } }],
    },
  };
}

function textPreviewBlocks(upload) {
  if (!isPreviewableText(upload.contentType)) return [];
  const text = readFileSync(upload.filePath, 'utf8').slice(0, 1_900);
  return [
    {
      object: 'block',
      type: 'code',
      code: {
        language: upload.contentType === 'application/json' ? 'json' : 'plain text',
        caption: [{ type: 'text', text: { content: `${upload.filename} preview` } }],
        rich_text: [{ type: 'text', text: { content: text } }],
      },
    },
  ];
}

function isPreviewableText(contentType) {
  return ['application/json', 'text/html', 'text/markdown', 'text/plain'].includes(contentType);
}

function captionFor({ caption, upload, index }) {
  if (!caption) return upload.filename;
  const captions = String(caption)
    .split('|')
    .map((value) => value.trim());
  return captions[index] || captions[0] || upload.filename;
}

async function notionFormRequest({ notionToken, path, method, body }) {
  const res = await fetch(`https://api.notion.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${notionToken}`,
      'Notion-Version': NOTION_FILE_UPLOAD_VERSION,
    },
    body,
  });

  return parseNotionResponse(res, method, path);
}

async function parseNotionResponse(res, method, path) {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion request failed: ${method} ${path} ${res.status} ${text}`);
  }

  return res.json();
}

function inferContentType(path) {
  const ext = extname(path).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.json') return 'application/json';
  if (ext === '.html') return 'text/html';
  if (ext === '.md') return 'text/markdown';
  return 'application/octet-stream';
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function printHelp() {
  console.log(`Notion file upload

Usage:
  pnpm activity:notion-upload-file --activity <id> --attempt <id> --file <path> [options]
  pnpm activity:notion-upload-file --activity <id> --attempt <id> --files <a,b,c> --layout columns --page <id>

Options:
  --file <path>           Upload one file
  --files <a,b,c>         Upload multiple files, comma-separated
  --filename <name>       Override uploaded filename; comma-separated for --files
  --content-type <type>   Override inferred MIME type
  --page <id>             Attach uploaded file/image to this Notion page
  --layout single|columns Attach multiple files vertically or side-by-side columns
  --heading <text>        Optional heading before attached evidence
  --section <title>       Attach evidence inside a childable section toggle; creates it if missing
  --caption <text>        Caption; use | separators for multiple files
  --render-text           Also render small text/json files as readable Notion code blocks
  --text-only             Render text/json as Notion code blocks without uploading a file link
  --allow-outside-artifacts Allow uploading files outside the activity artifact root
  --require-token true    Fail instead of returning partial when no Notion token is available
`);
}
