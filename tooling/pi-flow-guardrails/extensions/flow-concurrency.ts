import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from 'typebox';

type AgentTask = {
  name?: string;
  task: string;
  cwd?: string;
  tools?: string[];
  model?: string;
};

type AgentResult = {
  id: string;
  name: string;
  task: string;
  status: 'running' | 'done' | 'failed';
  startedAt: string;
  finishedAt?: string;
  cwd: string;
  output: string;
  error?: string;
};

type FlowRun = {
  id: string;
  mode: 'single' | 'parallel' | 'chain';
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'done' | 'failed';
  results: AgentResult[];
};

type FlowState = {
  runs: FlowRun[];
};

const READ_ONLY_TOOLS = ['read', 'grep', 'find', 'ls'];
const READ_ONLY_TOOL_SET = new Set(READ_ONLY_TOOLS);
const DEFAULT_CONCURRENCY = Number(process.env.PI_FLOW_CONCURRENCY ?? 4);
const MAX_TASKS = Number(process.env.PI_FLOW_MAX_TASKS ?? 8);
const DEFAULT_AGENT_MODEL = process.env.PI_FLOW_AGENT_MODEL ?? 'gpt-5.5';
const stateFile = path.join(os.homedir(), '.pi', 'agent', 'flow-guardrails', 'state.json');

function now() {
  return new Date().toISOString();
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function readState(): Promise<FlowState> {
  try {
    return JSON.parse(await readFile(stateFile, 'utf8')) as FlowState;
  } catch {
    return { runs: [] };
  }
}

async function writeState(state: FlowState) {
  await mkdir(path.dirname(stateFile), { recursive: true });
  state.runs = state.runs.slice(-50);
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  if (currentScript && !currentScript.startsWith('/$bunfs/root/')) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }
  return { command: 'pi', args };
}

function resolveScopedCwd(defaultCwd: string, requested?: string): string {
  const cwd = requested ? path.resolve(defaultCwd, requested) : defaultCwd;
  const relative = path.relative(defaultCwd, cwd);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return defaultCwd;
  return cwd;
}

function readOnlyTools(requested?: string[]): string[] {
  const tools = requested?.length ? requested : READ_ONLY_TOOLS;
  const safe = tools.filter((tool) => READ_ONLY_TOOL_SET.has(tool));
  return safe.length ? safe : READ_ONLY_TOOLS;
}

async function runTask(
  task: AgentTask,
  index: number,
  defaultCwd: string,
  signal?: AbortSignal,
): Promise<AgentResult> {
  const id = makeId(`agent${index + 1}`);
  const name = task.name || `agent-${index + 1}`;
  const cwd = resolveScopedCwd(defaultCwd, task.cwd);
  const tools = readOnlyTools(task.tools);
  const prompt = [
    `You are a scoped, read-only parallel research agent named ${name}.`,
    'Rules:',
    '- Stay inside the requested task scope.',
    '- Prefer concise findings with file paths and evidence.',
    '- Do not modify files. If implementation is needed, return a plan for the coordinator.',
    '- End with: Summary, Evidence, Risks, Recommended next step.',
    '',
    `Task: ${task.task}`,
  ].join('\n');

  const args = ['--mode', 'json', '-p', '--no-session', '--tools', tools.join(',')];
  args.push('--model', task.model ?? DEFAULT_AGENT_MODEL);
  args.push(prompt);

  const invocation = getPiInvocation(args);
  const startedAt = now();

  return await new Promise<AgentResult>((resolve) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const abort = () => child.kill('SIGTERM');
    signal?.addEventListener('abort', abort, { once: true });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('close', (code) => {
      signal?.removeEventListener('abort', abort);
      const output = stdout.trim().slice(-20000);
      const error = stderr.trim().slice(-8000);
      resolve({
        id,
        name,
        task: task.task,
        status: code === 0 ? 'done' : 'failed',
        startedAt,
        finishedAt: now(),
        cwd,
        output,
        error: error || undefined,
      });
    });
  });
}

async function mapLimited<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    new Array(Math.max(1, Math.min(concurrency, items.length))).fill(0).map(async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await fn(items[index]!, index);
      }
    }),
  );
  return results;
}

async function recordRun(run: FlowRun) {
  const state = await readState();
  const existing = state.runs.findIndex((item) => item.id === run.id);
  if (existing >= 0) state.runs[existing] = run;
  else state.runs.push(run);
  await writeState(state);
}

function statusIcon(status: AgentResult['status'] | FlowRun['status']): string {
  if (status === 'done') return '✓';
  if (status === 'failed') return '✗';
  return '…';
}

function shortTask(task: string): string {
  return task.replace(/\s+/g, ' ').trim().slice(0, 96);
}

function renderRunTree(run: FlowRun): string {
  const header = `${statusIcon(run.status)} ${run.id} · ${run.mode} · ${run.status} · ${run.results.length} task(s)`;
  if (run.results.length === 0) return header;

  const lines = [header];
  run.results.forEach((result, index) => {
    const last = index === run.results.length - 1;
    const branch = last ? '└─' : '├─';
    const child = last ? '  ' : '│ ';
    lines.push(`${branch} ${statusIcon(result.status)} ${result.name} · ${result.status}`);
    lines.push(`${child}  cwd: ${result.cwd}`);
    lines.push(`${child}  task: ${shortTask(result.task)}`);
  });
  return lines.join('\n');
}

type ThemeLike = {
  fg(color: string, text: string): string;
};

function colorizeRunTree(tree: string, theme: ThemeLike): string {
  return tree
    .split('\n')
    .map((line) => {
      let colored = line
        .replace(/[├└]─|│/g, (glyph) => theme.fg('dim', glyph))
        .replace(/cwd:/g, theme.fg('muted', 'cwd:'))
        .replace(/task:/g, theme.fg('muted', 'task:'));

      if (line.includes('✗') || line.includes('failed')) {
        colored = colored.replace('✗', theme.fg('error', '✗'));
        return theme.fg('error', colored);
      }
      if (line.includes('✓') || line.includes('done')) {
        colored = colored.replace('✓', theme.fg('success', '✓'));
        return colored.replace(/\bdone\b/g, theme.fg('success', 'done'));
      }
      if (line.includes('…') || line.includes('running')) {
        colored = colored.replace('…', theme.fg('warning', '…'));
        return colored.replace(/\brunning\b/g, theme.fg('warning', 'running'));
      }
      return colored;
    })
    .join('\n');
}

async function renderStateTree(): Promise<string> {
  const state = await readState();
  const runs = state.runs.slice(-8);
  if (runs.length === 0) return 'No flow agent runs recorded yet.';
  return runs.map(renderRunTree).join('\n\n');
}

export default function flowConcurrency(pi: ExtensionAPI) {
  pi.registerTool({
    name: 'flow_agents',
    label: 'Flow Agents',
    description:
      'Run scoped read-only Pi subagents in single, parallel, or chain mode with persisted run state.',
    promptSnippet:
      'Run scoped read-only subagents for parallel repo research and sequential planning.',
    promptGuidelines: [
      'Use flow_agents for parallel read-only research. Do not use flow_agents to edit files; have agents return plans and evidence for the coordinator.',
      'Use flow_agents parallel mode only for independent tasks. Use chain mode when each task depends on the previous result.',
    ],
    parameters: Type.Object({
      mode: Type.Optional(
        Type.Union([Type.Literal('single'), Type.Literal('parallel'), Type.Literal('chain')]),
      ),
      tasks: Type.Array(
        Type.Object({
          name: Type.Optional(Type.String()),
          task: Type.String(),
          cwd: Type.Optional(Type.String()),
          tools: Type.Optional(
            Type.Array(Type.String(), {
              description:
                'Optional read-only tool subset. Unsafe tools are ignored; allowed: read, grep, find, ls.',
            }),
          ),
          model: Type.Optional(Type.String()),
        }),
      ),
      concurrency: Type.Optional(Type.Number()),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const input = params as { mode?: FlowRun['mode']; tasks: AgentTask[]; concurrency?: number };
      const tasks = input.tasks.slice(0, MAX_TASKS);
      const mode: FlowRun['mode'] = input.mode ?? (tasks.length > 1 ? 'parallel' : 'single');
      const concurrency = Math.max(
        1,
        Math.min(input.concurrency ?? DEFAULT_CONCURRENCY, DEFAULT_CONCURRENCY, tasks.length || 1),
      );
      const run: FlowRun = {
        id: makeId('run'),
        mode,
        startedAt: now(),
        status: 'running',
        results: [],
      };
      await recordRun(run);
      onUpdate?.({
        content: [
          {
            type: 'text',
            text: `Started ${mode} run ${run.id} with ${tasks.length} task(s).\n\n${renderRunTree(run)}`,
          },
        ],
        details: run,
      });

      let results: AgentResult[] = [];
      if (mode === 'chain') {
        let previous = '';
        for (let i = 0; i < tasks.length; i++) {
          const task = { ...tasks[i]!, task: tasks[i]!.task.replaceAll('{previous}', previous) };
          const result = await runTask(task, i, ctx.cwd, signal);
          results.push(result);
          previous = result.output || result.error || '';
          run.results = results;
          await recordRun(run);
          onUpdate?.({
            content: [
              {
                type: 'text',
                text: `Chain progress: ${i + 1}/${tasks.length}\n\n${renderRunTree(run)}`,
              },
            ],
            details: run,
          });
          if (result.status === 'failed') break;
        }
      } else {
        results = await mapLimited(
          tasks,
          mode === 'single' ? 1 : concurrency,
          async (task, index) => {
            const result = await runTask(task, index, ctx.cwd, signal);
            run.results = [...run.results, result];
            await recordRun(run);
            onUpdate?.({
              content: [
                {
                  type: 'text',
                  text: `Agent complete: ${result.name} (${result.status})\n\n${renderRunTree(run)}`,
                },
              ],
              details: run,
            });
            return result;
          },
        );
      }

      run.results = results;
      run.finishedAt = now();
      run.status = results.every((result) => result.status === 'done') ? 'done' : 'failed';
      await recordRun(run);

      const summary = results
        .map(
          (result) =>
            `## ${result.name} (${result.status})\n${result.output || result.error || 'No output.'}`,
        )
        .join('\n\n---\n\n');
      return {
        content: [
          {
            type: 'text',
            text: `Flow agent run ${run.id}: ${run.status}\n\n${renderRunTree(run)}\n\n${summary}`,
          },
        ],
        details: run,
        isError: run.status === 'failed',
      };
    },
  });

  pi.registerCommand('flow-tree', {
    description: 'Show recent flow agent runs as a task tree',
    handler: async (_args, ctx) => {
      const tree = await renderStateTree();
      ctx.ui.notify(colorizeRunTree(tree, ctx.ui.theme), 'info');
    },
  });

  pi.registerCommand('flow-parallel', {
    description: 'Seed editor with a simple flow_agents parallel task template',
    handler: async (_args, ctx) => {
      ctx.ui.setEditorText(
        `Use flow_agents in parallel mode with these tasks:\n1. scout: inspect relevant files and existing patterns for <task>\n2. reviewer: identify risks, tests, and platform impact for <task>\n3. planner: propose the smallest safe implementation plan for <task>`,
      );
    },
  });
}
