import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent';

type PolicyMode = 'observe' | 'warn' | 'block';
type FlowGate =
  | { state: 'open' }
  | {
      state: 'blocked';
      reason: string;
      requiredAction: string;
      dirtyFiles: string[];
      createdAt: string;
    };

const FLOW = 'edit → impact → commit → lint/build → simplify → security → push';
const QUALITY_GATE = 'lint → build-web → tests → simplify → security';
const MODE = getPolicyMode();
const MAX_DEPENDENTS = 10;
const MAX_DIRTY_FILES = getPositiveIntEnv('PI_FLOW_MAX_DIRTY_FILES', 5);
const AUTO_COMMIT = getBooleanEnv('PI_FLOW_AUTO_COMMIT', false);

const sessionEditedFiles = new Set<string>();
let flowGate: FlowGate = { state: 'open' };

const PROTECTED_PATTERNS = [
  /(^|\/)\.env(\.|$)/,
  /(^|\/)\.claude\/\.state(\/|$)/,
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)\.git(\/|$)/,
  /(^|\/)dist(\/|$)/,
  /(^|\/)build(\/|$)/,
];

const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA |)?PRIVATE KEY-----/,
  /\b(?:sk|pk|rk|orsk)-[A-Za-z0-9_\-]{16,}\b/,
  /\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*['\"]?[A-Za-z0-9_\-./+=]{16,}/i,
  /\b(?:SUPABASE_SERVICE_ROLE_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|GROQ_API_KEY)\s*=/,
];

let footerState = {
  branch: 'no-git',
  dirty: '?',
  worktrees: '?wt',
  note: 'booting',
  risk: 'risk: n/a',
};

function getPolicyMode(): PolicyMode {
  const raw = process.env.PI_FLOW_MODE?.toLowerCase();
  return raw === 'observe' || raw === 'block' || raw === 'warn' ? raw : 'warn';
}

function getPositiveIntEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.toLowerCase();
  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return true;
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false;
  return fallback;
}

function relPath(ctx: ExtensionContext, path: string): string {
  return path.startsWith(ctx.cwd + '/') ? path.slice(ctx.cwd.length + 1) : path;
}

function isEditTool(toolName: string): boolean {
  return toolName === 'edit' || toolName === 'write';
}

function getPath(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const record = input as Record<string, unknown>;
  return typeof record.path === 'string'
    ? record.path
    : typeof record.file_path === 'string'
      ? record.file_path
      : undefined;
}

function isProtected(path: string): boolean {
  return PROTECTED_PATTERNS.some((pattern) => pattern.test(path));
}

function classifyRisk(path: string): string {
  if (
    /\b(src|lib)\/.*(auth|session|fetch|request|client|db|schema|sync|store|environment|platform)/i.test(
      path,
    )
  ) {
    return 'risk: shared/high';
  }
  if (/src-tauri|tauri|ios|android|windows|macos/i.test(path)) return 'risk: platform';
  if (/__tests__|\.test\.|\.spec\.|docs?\//i.test(path)) return 'risk: low';
  if (/\.(ts|tsx|js|jsx)$/.test(path)) return 'risk: code';
  return 'risk: low';
}

function parseScopedCommitArgs(
  args: string,
): { files: string[]; message: string; why: string } | undefined {
  const [filesPart, whyPart = ''] = args.split(/\s+--why\s+/);
  const tokens = filesPart.trim().split(/\s+/).filter(Boolean);
  const messageFlag = tokens.findIndex((token) => token === '-m' || token === '--message');
  if (messageFlag <= 0 || messageFlag === tokens.length - 1) return undefined;

  const files = tokens.slice(0, messageFlag);
  const message = tokens
    .slice(messageFlag + 1)
    .join(' ')
    .trim();
  const why = whyPart.trim();
  if (files.length === 0 || !message || !why) return undefined;
  return { files, message, why };
}

function hasSecret(text: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

function shouldBlock(): boolean {
  return MODE === 'block';
}

function shouldGate(): boolean {
  return MODE !== 'observe';
}

function isFlowGateBlocked(): boolean {
  return shouldGate() && flowGate.state === 'blocked';
}

function flowGateReason(): string {
  if (flowGate.state === 'open') return 'Flow gate is open.';
  return [
    `Flow gate closed: ${flowGate.reason}`,
    `Required action: ${flowGate.requiredAction}`,
    `Dirty files: ${flowGate.dirtyFiles.length}`,
  ].join('\n');
}

function closeFlowGate(ctx: ExtensionContext, reason: string, dirty: string[]) {
  if (!shouldGate()) return;
  flowGate = {
    state: 'blocked',
    reason,
    requiredAction: 'Commit, stash, or archive current work before more edits.',
    dirtyFiles: dirty.map(statusPath),
    createdAt: new Date().toISOString(),
  };
  notifyPolicy(ctx, `${flowGateReason()}\nUse /commit-logical with explicit files.`, 'error');
}

function blockForFlowGate(ctx: ExtensionContext): { block: true; reason: string } | undefined {
  if (!isFlowGateBlocked()) return undefined;
  const reason = flowGateReason();
  notifyPolicy(ctx, reason, 'error');
  return { block: true, reason };
}

async function refreshFlowGate(pi: ExtensionAPI, ctx: ExtensionContext) {
  if (flowGate.state === 'open') return;
  const dirty = await dirtyFiles(pi).catch(() => []);
  if (dirty.length <= MAX_DIRTY_FILES) {
    flowGate = { state: 'open' };
    notifyPolicy(ctx, 'Flow gate cleared. Continue with the next logical change.', 'info');
    await updateStatus(pi, ctx, 'gate cleared');
  }
}

function isMutatingBashCommand(command: string): boolean {
  return /\b(?:edit|python|python3|node|perl|ruby|tee|printf|echo|touch|mv|cp|rm|mkdir)\b/.test(
    command,
  );
}

function isFlowGateRemediationCommand(command: string): boolean {
  return /^\s*git\s+(?:status|diff|add|commit|stash|reset)(?:\s|$)/.test(command);
}

async function exec(
  pi: ExtensionAPI,
  command: string,
  args: string[],
  timeout = 5000,
): Promise<string> {
  const result = await pi.exec(command, args, { timeout });
  return `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
}

async function git(args: string[], pi: ExtensionAPI): Promise<string> {
  return exec(pi, 'git', args);
}

async function stagedDiff(pi: ExtensionAPI): Promise<string> {
  return git(['diff', '--cached'], pi);
}

function statusPath(line: string): string {
  const raw = line.slice(3).trim();
  const renameTarget = raw.split(' -> ').at(-1);
  return renameTarget ?? raw;
}

async function autoCommitSessionFiles(pi: ExtensionAPI, ctx: ExtensionContext) {
  if (!AUTO_COMMIT || sessionEditedFiles.size === 0) return;

  const dirty = await dirtyFiles(pi).catch(() => []);
  const dirtySet = new Set(dirty.map(statusPath));
  const files = [...sessionEditedFiles].filter((file) => dirtySet.has(file));
  if (files.length === 0) return;

  await git(['add', ...files], pi);
  const diff = await stagedDiff(pi);
  if (hasSecret(diff)) {
    notifyPolicy(
      ctx,
      'Auto-commit stopped: potential secret detected in scoped staged diff.',
      'error',
    );
    await git(['reset', '--', ...files], pi).catch(() => '');
    return;
  }

  const sessionFile = ctx.sessionManager.getSessionFile?.() ?? 'ephemeral';
  const sessionName = pi.getSessionName?.() ?? 'unnamed';
  await git(
    [
      'commit',
      '-m',
      'chore: auto-commit pi session edit',
      '-m',
      `Why: Keep Pi session edits scoped and prevent dirty work from accumulating.\nSession: ${sessionName}\nPi session file: ${sessionFile}\nFiles: ${files.join(', ')}`,
    ],
    pi,
  );
  files.forEach((file) => sessionEditedFiles.delete(file));
  notifyPolicy(ctx, `Auto-committed scoped Pi session files: ${files.join(', ')}`, 'info');
  await updateStatus(pi, ctx, 'auto-committed');
}

async function findDependents(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  relative: string,
): Promise<string[]> {
  const sourceMatch = relative.match(/^(.*\/)?src\/(.+)\.(tsx?|jsx?)$/);
  if (!sourceMatch) return [];
  const importPath = sourceMatch[2];
  const patterns = [`@/${importPath}`];
  if (importPath.endsWith('/index')) patterns.push(`@/${importPath.slice(0, -'/index'.length)}`);

  const dependents = new Set<string>();
  for (const pattern of patterns) {
    try {
      const output = await exec(pi, 'rg', ['-l', pattern, ctx.cwd], 8000);
      for (const line of output.split('\n').filter(Boolean)) {
        const rel = relPath(ctx, line.trim());
        if (rel !== relative) dependents.add(rel);
      }
    } catch {
      // rg may return non-zero when there are no matches.
    }
  }
  return [...dependents].slice(0, MAX_DEPENDENTS);
}

async function dirtyFiles(pi: ExtensionAPI): Promise<string[]> {
  const status = await git(['status', '--porcelain'], pi);
  return status.split('\n').filter(Boolean);
}

function dirtyWarnAt(): number {
  return Math.max(1, MAX_DIRTY_FILES - 1);
}

async function enforceDirtyBudget(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<{ block: true; reason: string } | undefined> {
  let dirty: string[];
  try {
    dirty = await dirtyFiles(pi);
  } catch {
    return undefined;
  }

  if (dirty.length < dirtyWarnAt()) {
    await refreshFlowGate(pi, ctx);
    return undefined;
  }

  const overBudget = dirty.length > MAX_DIRTY_FILES;
  const reason = overBudget
    ? `Dirty budget exceeded: ${dirty.length}/${MAX_DIRTY_FILES}. Commit, stash, or archive before more edits.`
    : `Commit soon: ${dirty.length}/${MAX_DIRTY_FILES} dirty files.`;
  if (overBudget) closeFlowGate(ctx, reason, dirty);
  else notifyPolicy(ctx, `${reason}\nUse /commit-logical with explicit files.`, 'warning');
  await updateStatus(
    pi,
    ctx,
    overBudget ? `dirty ${dirty.length}/${MAX_DIRTY_FILES}` : 'commit soon',
  );
  if (overBudget && shouldGate()) return { block: true, reason: flowGateReason() };
  return undefined;
}

async function updateStatus(pi: ExtensionAPI, ctx: ExtensionContext, note?: string, risk?: string) {
  if (!ctx.hasUI) return;

  let branch = 'no-git';
  let dirty = '?';
  let worktrees = '?wt';
  try {
    branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], pi)) || 'detached';
    const files = await dirtyFiles(pi);
    dirty = files.length ? `${files.length}Δ` : 'clean';
    const worktreeList = await git(['worktree', 'list', '--porcelain'], pi);
    worktrees = `${worktreeList.split('\n').filter((line) => line.startsWith('worktree ')).length}wt`;
  } catch {
    // Non-git folders are fine.
  }

  footerState = {
    branch,
    dirty,
    worktrees,
    note: note ?? footerState.note,
    risk: risk ?? footerState.risk,
  };
  ctx.ui.setStatus(
    'flow-guardrails',
    `🚀 Openread ${formatBranch(branch)} ${formatDirty(dirty)} ${worktrees}${footerState.note ? ` · ${footerState.note}` : ''}`,
  );
}

function formatBranch(branch?: string): string {
  return ` ${branch || 'no-branch'}`;
}

function formatDirty(dirty: string): string {
  return dirty === 'clean' ? '✓ clean' : `✚ ${dirty}`;
}

function notifyPolicy(
  ctx: ExtensionContext,
  message: string,
  level: 'info' | 'warning' | 'error' = 'warning',
) {
  if (!ctx.hasUI) return;
  ctx.ui.notify(`[flow:${MODE}] ${message}`, level);
}

export default function flowGuardrails(pi: ExtensionAPI) {
  pi.on('session_start', async (_event, ctx) => {
    await updateStatus(pi, ctx, 'ready', `mode: ${MODE}`);
    await enforceDirtyBudget(pi, ctx);
    ctx.ui.setFooter((_tui, theme, footerData) => ({
      invalidate() {},
      render(width: number): string[] {
        const gitBranch = footerData.getGitBranch?.() ?? footerState.branch;
        const text = [
          theme.fg('accent', '🚀 Openread'),
          theme.fg('muted', formatBranch(gitBranch || footerState.branch)),
          footerState.dirty === 'clean'
            ? theme.fg('success', formatDirty('clean'))
            : theme.fg('warning', formatDirty(footerState.dirty)),
          theme.fg('muted', footerState.worktrees),
          theme.fg('dim', footerState.note),
          theme.fg('muted', QUALITY_GATE),
        ].join('  ');
        return [text.length > width ? text.slice(0, Math.max(0, width - 1)) : text];
      },
    }));
    ctx.ui.setWidget(
      'flow-guardrails',
      [
        `Flow: ${FLOW}`,
        'Guardrails: scoped edits, specific-file commits, build-web after lint, no hook bypass.',
      ],
      { placement: 'belowEditor' },
    );
  });

  pi.on('tool_call', async (event, ctx) => {
    if (!isEditTool(event.toolName)) return;

    const gateBlock = blockForFlowGate(ctx);
    if (gateBlock) return gateBlock;

    const dirtyBudgetResult = await enforceDirtyBudget(pi, ctx);
    if (dirtyBudgetResult) return dirtyBudgetResult;

    const target = getPath(event.input);
    if (!target) return;

    const relative = relPath(ctx, target);
    const risk = classifyRisk(relative);
    if (isProtected(relative)) {
      const reason = `Protected path: ${relative}`;
      notifyPolicy(ctx, reason, 'error');
      if (shouldBlock()) return { block: true, reason };
    }

    const dependents = await findDependents(pi, ctx, relative);
    const dependentSummary = dependents.length
      ? ` Dependents: ${dependents.join(', ')}${dependents.length === MAX_DEPENDENTS ? ', …' : ''}`
      : '';
    notifyPolicy(
      ctx,
      `Impact before ${event.toolName}: ${relative} (${risk}).${dependentSummary}`,
      'info',
    );
    await updateStatus(pi, ctx, `editing ${relative}`, risk);
  });

  pi.on('tool_result', async (event, ctx) => {
    if (!isEditTool(event.toolName)) return;

    const target = getPath(event.input);
    const relative = target ? relPath(ctx, target) : 'edited file';
    if (target) sessionEditedFiles.add(relative);
    notifyPolicy(
      ctx,
      AUTO_COMMIT
        ? `Post-edit: auto-commit is on for scoped session files (${relative}).`
        : `Post-edit: review diff, stage specific files, commit logical change (${relative}).`,
    );
    await updateStatus(pi, ctx, AUTO_COMMIT ? 'auto-commit check' : 'commit next');
    await autoCommitSessionFiles(pi, ctx);
    await enforceDirtyBudget(pi, ctx);
  });

  pi.on('tool_call', async (event, ctx) => {
    if (event.toolName !== 'bash') return;
    const command = (event.input as { command?: string }).command ?? '';

    if (/git\s+add\s+(\.|-A|--all)(\s|$)/.test(command)) {
      const reason = 'Use git add <specific-files>; avoid staging unrelated work.';
      notifyPolicy(ctx, reason, 'error');
      if (MODE !== 'observe') return { block: true, reason };
    }

    if (isMutatingBashCommand(command)) {
      if (isFlowGateBlocked() && !isFlowGateRemediationCommand(command)) {
        return blockForFlowGate(ctx);
      }
      const dirtyBudgetResult = await enforceDirtyBudget(pi, ctx);
      if (dirtyBudgetResult) return dirtyBudgetResult;
    }

    if (/git\s+commit/.test(command)) {
      const diff = await stagedDiff(pi).catch(() => '');
      if (hasSecret(diff)) {
        const reason =
          'Potential secret detected in staged diff. Unstage and inspect before committing.';
        notifyPolicy(ctx, reason, 'error');
        if (MODE !== 'observe') return { block: true, reason };
      }
      notifyPolicy(
        ctx,
        'Commit hook: include why/session trail. Prefer /commit-logical <files> -m <message> --why <why>.',
        'info',
      );
      await updateStatus(pi, ctx, 'commit hook');
    }

    if (/git\s+push/.test(command)) {
      notifyPolicy(ctx, `Pre-push gate reminder: ${QUALITY_GATE}.`, 'warning');
      await updateStatus(pi, ctx, 'pre-push');
    }
  });

  pi.on('tool_result', async (event, ctx) => {
    if (event.toolName !== 'bash') return;
    const command = (event.input as { command?: string }).command ?? '';
    if (/^\s*git\s+(?:commit|stash|reset)(?:\s|$)/.test(command)) {
      await refreshFlowGate(pi, ctx);
    }
  });

  pi.registerCommand('commit-logical', {
    description: 'Stage specific files and commit with session + why metadata',
    handler: async (args, ctx) => {
      const parsed = parseScopedCommitArgs(args);
      if (!parsed) {
        ctx.ui.notify(
          'Usage: /commit-logical <file...> -m <message> --why <why this change exists>',
          'warning',
        );
        return;
      }

      await git(['add', ...parsed.files], pi);
      const diff = await stagedDiff(pi);
      if (hasSecret(diff)) {
        ctx.ui.notify('Potential secret detected in staged diff. Commit aborted.', 'error');
        await updateStatus(pi, ctx, 'secret scan failed');
        return;
      }

      const sessionFile = ctx.sessionManager.getSessionFile?.() ?? 'ephemeral';
      const sessionName = pi.getSessionName?.() ?? 'unnamed';
      await git(
        [
          'commit',
          '-m',
          parsed.message,
          '-m',
          `Why: ${parsed.why}\nSession: ${sessionName}\nPi session file: ${sessionFile}`,
        ],
        pi,
      );
      await refreshFlowGate(pi, ctx);
      await updateStatus(pi, ctx, 'committed');
      ctx.ui.notify(`Committed scoped change: ${parsed.message}`, 'info');
    },
  });

  async function showFlowStatus(ctx: ExtensionContext) {
    await updateStatus(pi, ctx, 'flow checked');
    let status = '';
    try {
      status = await git(['status', '--short'], pi);
    } catch {
      status = 'Unable to read git status.';
    }
    ctx.ui.notify(
      `Flow: ${FLOW}\nMode: ${MODE}\nGate: ${flowGate.state}\nAuto-commit: ${AUTO_COMMIT ? 'on' : 'off'}\nDirty budget: warn at ${dirtyWarnAt()}, max ${MAX_DIRTY_FILES}\n${status || 'Working tree clean.'}`,
      'info',
    );
  }

  pi.registerCommand('flow', {
    description: 'Show flow guardrails and git status',
    handler: async (_args, ctx) => {
      await showFlowStatus(ctx);
    },
  });
}
