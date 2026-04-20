// apps/openread-app/e2e/workflow/integration/boundaries/force-push.spec.ts
//
// Probe-driven workflow · force-push to main blocked by pre-push hook (§8.2, J2).
//
// Covers: [axis 33] force-push-protection · [axis 34] branch-protection ·
//         [axis 35] lefthook-pre-push
//
// Validates that the lefthook `pre-push` hook rejects any `git push --force`
// (or `--force-with-lease`) to main/master. Rejecting force-push prevents
// rewriting history on protected branches and complements GitHub branch
// protection (see docs/branch-protection.md).
//
// Reference: docs/probe-driven-workflow-implementation.md §10 (lefthook.yml),
//            docs/branch-protection.md.

import { test, expect } from '../../../_helpers/probe.playwright.ts';

test.describe('boundaries · force-push', () => {
  test('[axis 33] git push --force to main → pre-push rejects', async ({
    testWorktree,
  }) => {
    // GIVEN: testWorktree simulating local repo with lefthook installed
    //        and an upstream `main` at some SHA.
    //        Local `main` rewritten to new SHA (rebase or amend).
    // WHEN:  user runs `git push --force origin main`.
    // THEN:  lefthook pre-push step rejects; exit non-zero;
    //        message identifies the blocked branch.

    test.skip(
      true,
      'force-push — pending lefthook.yml + branch-protection pre-push step',
    );

    // TODO: add lefthook.yml rule that inspects refspec against protected list
    // TODO: execute simulated push and assert exit != 0
    // TODO: assert stderr mentions 'force push to main blocked'
    expect(testWorktree.path).toBeTruthy();
  });
});
