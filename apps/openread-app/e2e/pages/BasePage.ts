// Assertions live in specs — POMs expose actions + queries only, so
// failure messages point at test intent rather than a helper.

import type { Page } from '@playwright/test';

export abstract class BasePage {
  constructor(protected readonly page: Page) {}
}
