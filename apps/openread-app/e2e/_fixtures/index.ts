// apps/openread-app/e2e/_fixtures/index.ts
//
// Probe-driven workflow — fixture aggregator (§3 Bundle C, C3).
//
// Each fixture file exports:
//   - a typed shape (`type <Name>Fixture`)
//   - a Playwright-compatible fixture function using `use(value)` teardown
//
// This file composes them into a single `ProbeFixtures` type + `fixtures`
// object consumed by ../_helpers/probe.playwright.ts.

import { testDbFixture, type TestDbFixture } from './test-db';
import { testWorktreeFixture, type TestWorktreeFixture } from './test-worktree';
import { mockFigmaFixture, type MockFigmaFixture } from './mock-figma';
import { loginFixture, type LoginFixture } from './login';
import { makeBookFixture, type MakeBookFixture } from './make-book';

export type ProbeFixtures = {
  testDb: TestDbFixture;
  testWorktree: TestWorktreeFixture;
  mockFigma: MockFigmaFixture;
  login: LoginFixture;
  makeBook: MakeBookFixture;
};

// Playwright's `extend` accepts an object whose values are fixture functions.
// We type-erase here (the individual files carry their own strict types) so
// composition stays ergonomic.
export const fixtures = {
  testDb: testDbFixture,
  testWorktree: testWorktreeFixture,
  mockFigma: mockFigmaFixture,
  login: loginFixture,
  makeBook: makeBookFixture,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

export {
  testDbFixture,
  testWorktreeFixture,
  mockFigmaFixture,
  loginFixture,
  makeBookFixture,
};

export type {
  TestDbFixture,
  TestWorktreeFixture,
  MockFigmaFixture,
  LoginFixture,
  MakeBookFixture,
};
