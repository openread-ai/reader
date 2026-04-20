// apps/openread-app/e2e/workflow/scenarios/S9.spec.ts
//
// Probe-driven workflow · E2E scenario (§8.1, J1).
//
// S9 — Session crash mid-L3 → resume
//
// Validates conductor durability: mid-L3 (tests-before-code inner loop) the
// conductor process is killed. A new session must be able to resume from the
// last committed checkpoint without re-running completed gates or losing
// test artifacts.

import { test, expect } from '../../_helpers/probe.playwright.ts';

test.describe('S9 — Session crash mid-L3 → resume', () => {
  test('recovers from mid-L3 crash without replaying completed gates', async ({
    testDb,
    testWorktree,
  }) => {
    // GIVEN: an in-flight feature that has passed P1/P2a/P2b and is mid-L3
    //   - testDb: gates table has verdict='passed' for P1/P2a/P2b
    //   - testWorktree: a partial test file written, not yet committed
    //
    // WHEN: the conductor process is killed (SIGKILL) during the test-sweep step
    //   - simulate with `process.kill(pid, 'SIGKILL')` on the child
    //   - user re-invokes /start-dev in the same worktree
    //   - conductor detects an open feature row and offers to resume
    //   - user accepts; conductor reads last checkpoint from SQLite
    //
    // THEN:
    //   - resumed session does NOT re-prompt P1/P2a/P2b (idempotent)
    //   - test-sweep restarts from scratch (mid-L3 is not a checkpoint)
    //   - SQLite features.stage eventually advances to 'done'
    //   - no duplicate gates rows for P1/P2a/P2b

    test.skip(true, 'S9 — pending conductor durability + resume handshake (§E1, §F2)');

    // TODO: assert gates row count per gate is exactly 1
    // TODO: assert features.resumed_count incremented by 1
    // TODO: assert no orphaned tmp/ entries in the bucket after resume
    expect(testDb).toBeDefined();
    expect(testWorktree).toBeDefined();
  });
});
