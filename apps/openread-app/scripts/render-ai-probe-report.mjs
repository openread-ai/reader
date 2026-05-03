import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { getProbeBatch } from '../e2e/probes/manifest.mjs';

const batch = process.argv[2] || 'critical';
const resultsPath = 'test-results/ai-probes/results.json';

if (!existsSync(resultsPath)) {
  console.error(
    `Missing ${resultsPath}. Run \`pnpm test:e2e:probes:critical\` or \`pnpm test:e2e:probes:eval\` first.`,
  );
  process.exit(1);
}

const raw = JSON.parse(readFileSync(resultsPath, 'utf8'));

function collectSpecs(suites, currentFile = '', acc = []) {
  for (const suite of suites || []) {
    const suiteFile = suite.file || currentFile;
    for (const spec of suite.specs || []) {
      const tests = (spec.tests || []).map((test) => {
        const lastResult = test.results?.[test.results.length - 1] || {};
        return {
          title: test.title,
          status: lastResult.status || test.status || 'unknown',
          duration: lastResult.duration || 0,
          annotations: test.annotations || [],
          error: lastResult.error?.message || null,
        };
      });

      acc.push({
        file: suiteFile,
        title: spec.title,
        tests,
      });
    }

    collectSpecs(suite.suites, suiteFile, acc);
  }

  return acc;
}

const manifest = getProbeBatch(batch);
const specs = collectSpecs(raw.suites || []);

const summary = raw.probes
  ? summaryFromProbeProgress(manifest, raw.probes)
  : summaryFromPlaywrightJson(manifest, specs);

function summaryFromProbeProgress(manifest, probes) {
  return manifest.map((probe) => {
    const entry = probes[probe.id];
    return {
      ...probe,
      status: entry?.status ?? 'missing',
      durationMs: entry?.durationMs ?? 0,
      annotations: [],
      errors: entry?.errorMessage ? [entry.errorMessage] : [],
    };
  });
}

function summaryFromPlaywrightJson(manifest, specs) {
  return manifest.map((probe) => {
    const spec = specs.find((entry) => entry.file?.endsWith(probe.specPath));
    const tests = spec?.tests || [];
    const failed = tests.some((test) => test.status !== 'passed');
    const annotations = tests.flatMap((test) => test.annotations || []);
    return {
      ...probe,
      status: tests.length === 0 ? 'missing' : failed ? 'failed' : 'passed',
      durationMs: tests.reduce((sum, test) => sum + (test.duration || 0), 0),
      annotations,
      errors: tests.map((test) => test.error).filter(Boolean),
    };
  });
}

const coverage = {
  batch,
  generatedAt: new Date().toISOString(),
  totals: {
    probes: summary.length,
    passed: summary.filter((item) => item.status === 'passed').length,
    failed: summary.filter((item) => item.status === 'failed').length,
    missing: summary.filter((item) => item.status === 'missing').length,
  },
  byMode: Object.fromEntries(
    ['live', 'mock'].map((mode) => [
      mode,
      {
        total: summary.filter((item) => item.mode === mode).length,
        passed: summary.filter((item) => item.mode === mode && item.status === 'passed').length,
      },
    ]),
  ),
  probes: summary,
};

const markdown = [
  `# AI Probe Eval Summary (${batch})`,
  '',
  `Generated: ${coverage.generatedAt}`,
  '',
  `- Passed: ${coverage.totals.passed}/${coverage.totals.probes}`,
  `- Failed: ${coverage.totals.failed}`,
  `- Missing: ${coverage.totals.missing}`,
  '',
  '| Probe | Mode | Status | Duration (ms) | Signals |',
  '| --- | --- | --- | ---: | --- |',
  ...summary.map(
    (item) =>
      `| ${item.id} | ${item.mode} | ${item.status} | ${item.durationMs} | ${item.expectedSignals.join(', ')} |`,
  ),
  '',
  '## Notes',
  '',
  ...summary.flatMap((item) => {
    const notes = [];
    if (item.errors.length > 0) notes.push(`- ${item.id}: ${item.errors.join(' | ')}`);
    if (item.annotations.length > 0) {
      notes.push(
        `- ${item.id} annotations: ${item.annotations
          .map((annotation) => `${annotation.type}=${annotation.description}`)
          .join(', ')}`,
      );
    }
    return notes;
  }),
  '',
];

mkdirSync('test-results/ai-probes', { recursive: true });
writeFileSync('test-results/ai-probes/coverage.json', JSON.stringify(coverage, null, 2));
writeFileSync('test-results/ai-probes/summary.md', markdown.join('\n'));

console.log(`Read ${resultsPath}`);
console.log('Wrote test-results/ai-probes/coverage.json');
console.log('Wrote test-results/ai-probes/summary.md');
