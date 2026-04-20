// apps/openread-app/e2e/workflow/integration/boundaries/state-bypass.spec.ts
//
// Probe-driven workflow · state-bypass blocked by hookify (§8.2, J2).
//
// Covers: [axis 31] state-bypass-prevention · [axis 32] hookify-enforcement
//
// Validates the hookify rule `block-state-bypass` (see
// .claude/hookify.block-state-bypass.local.md). Direct writes to
// `.claude/.state/**` must be intercepted by the pre-edit hook and fail.
// This prevents agents from side-channeling around the conductor API.
//
// Reference: docs/probe-driven-workflow-implementation.md §2.4 (four-store
// artifact boundary), docs/hook-system-architecture.md.

import { test, expect } from '../../../_helpers/probe.playwright.ts';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

const exec = promisify(execFile);

test.describe('boundaries · state-bypass', () => {
  test('[axis 31] echo into .claude/.state/* → hookify blocks', async ({
    testWorktree,
  }) => {
    // GIVEN: testWorktree with hookify rules installed.
    // WHEN:  an agent tries `echo > .claude/.state/anything`.
    // THEN:  the pre-edit hook rejects; file does not get created; exit
    //        non-zero; audit log captures the attempt.

    test.skip(
      true,
      'state-bypass — pending hookify dry-run harness + .state/ scaffold',
    );

    // TODO: assert the hookify rule intercepts direct FS writes to
    //       .claude/.state/** path (not only the tool-call vector)
    // TODO: verify the block is observable via a hook audit log / exit code
    const statePath = join(testWorktree.path, '.claude/.state');
    try {
      await mkdir(statePath, { recursive: true });
      await writeFile(join(statePath, 'poison.txt'), 'should-block');
      // If we reach here without a rejection, the block did NOT fire.
      // Leave assertion for the unskipped version.
    } catch {
      // expected path once the hookify harness is wired
    }
    expect(typeof exec).toBe('function');
  });
});
