# Activity Fixtures And Navigation

This folder is the shared navigation contract for activity capture and validation.
Every agent should reuse these helpers instead of writing one-off Playwright
navigation.

## Fixture Modes

- `anonymous`: use the default Playwright `page` fixture.
- `authenticated`: use `authenticatedPage` from `e2e/fixtures/auth.ts`.

## Screen Navigation

- `reader`: go to `/library`, wait for at least one seeded book, click the first
  book, wait for `/reader?ids=...`, then wait for the inline question bar.
- Other screens: navigate to the target route from `capture-plan.json`.

## Seed Requirement

Reader activity capture requires the test user from `.env.test.local` to have at
least one synced library book. Stage 3 readiness reports this as a prerequisite,
and Stage 4 will fail clearly if the seeded book is missing.

Agents should reuse this same test account and its existing seeded books by
default. Do not add, import, or require new books or file formats unless the
activity explicitly asks for a specific title, source, or format coverage.

## Agent Rule

Activity intent should become `capture-plan.json` first. Stage 3 validates the
plan and fixtures. Stage 4 and Stage 8 execute the plan through these helpers.
