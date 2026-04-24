import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent';

type Step = {
  name: string;
  command: string;
  status: 'pending' | 'passed' | 'failed' | 'skipped';
  output?: string;
};

type BootstrapReport = {
  command: 'openread-bootstrap' | 'openread-worktree';
  cwd: string;
  target?: string;
  branch?: string;
  base?: string;
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'passed' | 'failed';
  steps: Step[];
};

const stateDir = path.join(os.homedir(), '.pi', 'agent', 'flow-guardrails');
const reportFile = path.join(stateDir, 'openread-worktree-bootstrap.json');

function shell(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function parseArgs(args: string): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  const tokens = args.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!.replace(/^['"]|['"]$/g, '');
    if (!token.startsWith('--')) {
      if (!out._) out._ = token;
      continue;
    }
    const key = token.slice(2);
    const next = tokens[i + 1]?.replace(/^['"]|['"]$/g, '');
    if (!next || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

async function saveReport(report: BootstrapReport) {
  await mkdir(stateDir, { recursive: true });
  await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function runShell(pi: ExtensionAPI, step: Step, timeout = 120_000): Promise<Step> {
  const result = await pi.exec('bash', ['-lc', step.command], { timeout });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().slice(-8000);
  return { ...step, status: result.code === 0 ? 'passed' : 'failed', output };
}

async function runSteps(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  report: BootstrapReport,
  steps: Step[],
) {
  for (const step of steps) {
    ctx.ui.notify(`Openread bootstrap: ${step.name}`, 'info');
    const result = await runShell(pi, step);
    report.steps.push(result);
    await saveReport(report);
    if (result.status === 'failed') {
      report.status = 'failed';
      report.finishedAt = new Date().toISOString();
      await saveReport(report);
      ctx.ui.notify(`Openread bootstrap failed: ${step.name}\n${result.output ?? ''}`, 'error');
      return;
    }
  }
  report.status = 'passed';
  report.finishedAt = new Date().toISOString();
  await saveReport(report);
  ctx.ui.notify(`Openread bootstrap passed. Report: ${reportFile}`, 'info');
}

function bootstrapSteps(cwd: string, options: Record<string, string | boolean>): Step[] {
  const prefix = `cd ${shell(cwd)} && `;
  const steps: Step[] = [
    {
      name: 'submodules',
      command: `${prefix}git submodule update --init --recursive`,
      status: 'pending',
    },
    {
      name: 'dependencies',
      command: `${prefix}pnpm install --prefer-offline`,
      status: 'pending',
    },
    {
      name: 'vendors',
      command: `${prefix}pnpm --filter @openread/openread-app setup-vendors`,
      status: 'pending',
    },
  ];
  if (options.playwright) {
    steps.push({
      name: 'playwright browsers',
      command: `${prefix}pnpm --filter @openread/openread-app exec playwright install chromium webkit`,
      status: 'pending',
    });
  }
  return steps;
}

async function ensureCleanSource(pi: ExtensionAPI, ctx: ExtensionContext): Promise<boolean> {
  const status = await pi.exec('git', ['status', '--porcelain'], { timeout: 10_000 });
  if ((status.stdout ?? '').trim()) {
    ctx.ui.notify(
      'Openread worktree setup stopped: source worktree has uncommitted changes.',
      'error',
    );
    return false;
  }
  return true;
}

export default function openreadWorktree(pi: ExtensionAPI) {
  pi.registerCommand('openread-bootstrap', {
    description: 'Bootstrap the current Openread worktree: submodules, pnpm install, vendor assets',
    handler: async (args, ctx) => {
      const options = parseArgs(args);
      const report: BootstrapReport = {
        command: 'openread-bootstrap',
        cwd: ctx.cwd,
        startedAt: new Date().toISOString(),
        status: 'running',
        steps: [],
      };
      await saveReport(report);
      await runSteps(pi, ctx, report, bootstrapSteps(ctx.cwd, options));
    },
  });

  pi.registerCommand('openread-worktree', {
    description: 'Create and bootstrap a new Openread git worktree safely',
    handler: async (args, ctx) => {
      const options = parseArgs(args);
      const branch = String(options.branch ?? options._ ?? '').trim();
      if (!branch) {
        ctx.ui.notify(
          'Usage: /openread-worktree <branch> [--path <path>] [--base origin/main] [--playwright]',
          'warning',
        );
        return;
      }
      if (!(await ensureCleanSource(pi, ctx))) return;

      const base = String(options.base ?? 'origin/main');
      const target = path.resolve(
        ctx.cwd,
        String(options.path ?? path.join('..', `openread.ai.${branch.replaceAll('/', '-')}`)),
      );
      const report: BootstrapReport = {
        command: 'openread-worktree',
        cwd: ctx.cwd,
        target,
        branch,
        base,
        startedAt: new Date().toISOString(),
        status: 'running',
        steps: [],
      };
      await saveReport(report);

      const create = await runShell(pi, {
        name: 'create worktree',
        command: `git worktree add ${shell(target)} -b ${shell(branch)} ${shell(base)}`,
        status: 'pending',
      });
      report.steps.push(create);
      await saveReport(report);
      if (create.status === 'failed') {
        report.status = 'failed';
        report.finishedAt = new Date().toISOString();
        await saveReport(report);
        ctx.ui.notify(`Openread worktree creation failed.\n${create.output ?? ''}`, 'error');
        return;
      }

      await runSteps(pi, ctx, report, bootstrapSteps(target, options));
    },
  });
}
