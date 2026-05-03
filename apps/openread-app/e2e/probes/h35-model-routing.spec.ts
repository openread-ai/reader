import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/auth';
import { navigateToBookReader } from '../helpers/navigate-to-reader';

/**
 * H35 — Model routing per tier probe.
 *
 * Two scenarios:
 *
 *   H35a — Default platform model for the authenticated user's tier. The app
 *          usually sends the persisted UI model setting, so this probe deletes
 *          `model` from the outgoing request to exercise the server-side
 *          no-model-requested default path. The expected model is the first
 *          model returned by `/api/ai/models?source=platform`, which is backed
 *          by the same tier_config source of truth as model-routing.ts.
 *
 *   H35b — Silent fallback when a non-allowed model is requested. Intercept the
 *          outgoing POST to /api/ai/agentic-chat and swap the `model` field to
 *          a syntactically valid but non-platform model. Verify the server
 *          silently falls back to the tier default instead of surfacing an
 *          error or attempting to call the bogus model.
 *
 * Source: src/services/ai/model-routing.ts — `resolveModelForTier`.
 */

const BOOK_HASH = '65c789be32848655bc89109cb69cc712';
const QUERY = 'What is one key idea from this book?';
const DISALLOWED_PROBE_MODEL = 'openread/not-allowed-probe-model';

type PlatformModel = {
  id: string;
  name?: string;
  tier?: string;
};

async function waitForResponse(page: Page): Promise<string> {
  let responseText = '';
  try {
    await expect
      .poll(
        async () => {
          const result = await page.evaluate(() => {
            const candidates = Array.from(
              document.querySelectorAll('p, div[class*="message"], div[class*="Message"]'),
            );
            const responses = candidates
              .map((el) => (el as HTMLElement).innerText?.trim() ?? '')
              .filter(
                (t) =>
                  t.length > 30 &&
                  !t.includes('AI can make mistakes') &&
                  !t.startsWith('8 messages left') &&
                  !t.startsWith('Ask about this book') &&
                  !t.startsWith('What is one key'),
              );
            return responses.sort((a, b) => b.length - a.length)[0] ?? '';
          });
          responseText = result;
          return result.length;
        },
        { timeout: 90_000, intervals: [1000, 2000] },
      )
      .toBeGreaterThan(30);
  } catch {
    // Poll gave up; fall through with whatever we have.
  }
  return responseText;
}

async function getPlatformModels(page: Page): Promise<PlatformModel[]> {
  const models = await page.evaluate(async () => {
    const token = localStorage.getItem('token');
    if (!token) throw new Error('No auth token in localStorage');

    const response = await fetch('/api/ai/models?source=platform', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error(`Platform models request failed: ${response.status}`);
    }
    return (await response.json()) as PlatformModel[];
  });

  expect(models.length).toBeGreaterThan(0);
  return models;
}

function extractModelFromHeaders(responseHeaders: Array<Record<string, string>>): {
  model: string;
  provider: string;
  tier: string;
} {
  for (const headers of responseHeaders) {
    const model = headers['x-openread-ai-chat-model'];
    if (model) {
      return {
        model,
        provider: headers['x-openread-ai-chat-provider'] ?? 'unknown',
        tier: headers['x-openread-ai-planner-tier'] ?? 'unknown',
      };
    }
  }
  return { model: 'unknown', provider: 'unknown', tier: 'unknown' };
}

test('H35a — no requested model defaults to authenticated tier default', async ({
  authenticatedPage: page,
}) => {
  const responseHeaders: Array<Record<string, string>> = [];
  page.on('response', async (response) => {
    if (response.url().includes('/api/ai/agentic-chat')) {
      responseHeaders.push(await response.allHeaders());
    }
  });

  await page.route('**/api/ai/agentic-chat', async (route) => {
    const request = route.request();
    if (request.method() !== 'POST') {
      await route.continue();
      return;
    }

    const body = request.postDataJSON() as Record<string, unknown>;
    const defaultRouteBody = { ...body, provider: 'groq' };
    delete defaultRouteBody['model'];

    await route.continue({
      postData: JSON.stringify(defaultRouteBody),
      headers: { ...request.headers(), 'content-type': 'application/json' },
    });
  });

  const inlineInput = await navigateToBookReader(page, BOOK_HASH);
  const platformModels = await getPlatformModels(page);
  const expectedDefaultModel = platformModels[0]!.id;
  const expectedModelTier = platformModels[0]!.tier ?? 'unknown';

  await inlineInput.click();
  await inlineInput.fill(QUERY);
  await inlineInput.press('Enter');
  const h35aResponseText = await waitForResponse(page);

  const { model, provider, tier } = extractModelFromHeaders(responseHeaders);

  console.log('\n===== H35a DEFAULT MODEL =====');
  console.log(`Expected tier default: ${expectedDefaultModel} (${expectedModelTier})`);
  console.log(`Resolved model: ${model}`);
  console.log(`Resolved provider: ${provider}`);
  console.log(`Planner tier: ${tier}`);
  console.log('================================\n');

  test
    .info()
    .annotations.push(
      { type: 'H35a-expected-model', description: expectedDefaultModel },
      { type: 'H35a-model', description: model },
      { type: 'H35a-provider', description: provider },
      { type: 'H35a-model-tier', description: expectedModelTier },
    );

  // The agent must produce a response — if empty the model routing pipeline
  // failed entirely (no model resolved, or the request never reached Groq).
  expect(h35aResponseText.length).toBeGreaterThan(0);
  expect(model).toBe(expectedDefaultModel);
  expect(provider).toBe('groq');
});

test('H35b — disallowed platform model is silently downgraded', async ({
  authenticatedPage: page,
}) => {
  const responseHeaders: Array<Record<string, string>> = [];
  page.on('response', async (response) => {
    if (response.url().includes('/api/ai/agentic-chat')) {
      responseHeaders.push(await response.allHeaders());
    }
  });

  let interceptedBody: Record<string, unknown> | null = null;
  await page.route('**/api/ai/agentic-chat', async (route) => {
    const request = route.request();
    if (request.method() !== 'POST') {
      await route.continue();
      return;
    }
    const body = request.postDataJSON() as Record<string, unknown>;
    interceptedBody = { ...body };
    const swappedBody = {
      ...body,
      model: DISALLOWED_PROBE_MODEL,
      provider: 'groq',
    };
    await route.continue({
      postData: JSON.stringify(swappedBody),
      headers: { ...request.headers(), 'content-type': 'application/json' },
    });
  });

  const inlineInput = await navigateToBookReader(page, BOOK_HASH);
  const platformModels = await getPlatformModels(page);
  const expectedFallbackModel = platformModels[0]!.id;
  const expectedModelTier = platformModels[0]!.tier ?? 'unknown';

  await inlineInput.click();
  await inlineInput.fill(QUERY);
  await inlineInput.press('Enter');
  const response = await waitForResponse(page);

  const { model: resolvedModel, provider: resolvedProvider } =
    extractModelFromHeaders(responseHeaders);
  const requestedModel = (interceptedBody as { model?: string } | null)?.model ?? 'unknown';
  const silentDowngrade = resolvedModel === expectedFallbackModel && response.length > 30;

  console.log('\n===== H35b MODEL DOWNGRADE =====');
  console.log(`Requested model (after swap): ${DISALLOWED_PROBE_MODEL}`);
  console.log(`Original request model: ${requestedModel}`);
  console.log(`Expected fallback: ${expectedFallbackModel} (${expectedModelTier})`);
  console.log(`Server resolved to: ${resolvedModel} (${resolvedProvider})`);
  console.log(`Response produced: ${response.length > 30 ? 'yes' : 'no'}`);
  console.log(`Response length: ${response.length}`);
  console.log(`Silent downgrade: ${silentDowngrade}`);
  console.log('==================================\n');

  test
    .info()
    .annotations.push(
      { type: 'H35b-original-model', description: requestedModel },
      { type: 'H35b-swapped-model', description: DISALLOWED_PROBE_MODEL },
      { type: 'H35b-expected-fallback', description: expectedFallbackModel },
      { type: 'H35b-resolved-model', description: resolvedModel },
      { type: 'H35b-silent-downgrade', description: String(silentDowngrade) },
    );

  expect(response.length).toBeGreaterThan(30);
  expect(resolvedProvider).toBe('groq');
  expect(resolvedModel).toBe(expectedFallbackModel);
});
