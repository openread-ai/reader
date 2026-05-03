import { test, expect } from '../fixtures/auth';
import { navigateToBookReader } from '../helpers/navigate-to-reader';

/**
 * S01 — XSS response cleaner probe.
 *
 * Verifies that the ResponseCleaner (src/services/ai/utils/responseCleaner.ts)
 * strips dangerous HTML injected by the LLM before it reaches the DOM.
 *
 * Attack vectors under test:
 *   1. <script> tag injection — must never be inserted as a DOM node
 *   2. <iframe> injection — must be stripped
 *   3. <img onerror> injection — onerror attribute must be stripped
 *
 * The mock NDJSON stream sends all three payloads followed by benign text.
 * After the response renders we assert the dangerous elements/attributes are
 * absent from the assistant message area, and that benign content survived.
 *
 * Source: src/services/ai/utils/responseCleaner.ts (sanitize pass),
 *         src/components/assistant/Thread.tsx (renders markdown via
 *         react-markdown + rehype-sanitize or DOMPurify).
 */

const BOOK_HASH = '65c789be32848655bc89109cb69cc712';

const MOCK_NDJSON = [
  JSON.stringify({ type: 'text', text: 'Here is a summary: ' }),
  JSON.stringify({ type: 'text', text: "<script>alert('xss')</script>" }),
  JSON.stringify({ type: 'text', text: "<img src=x onerror=alert('xss')>" }),
  JSON.stringify({ type: 'text', text: "<iframe src='evil.com'></iframe>" }),
  JSON.stringify({ type: 'text', text: '[click](javascript:alert(1))' }),
  JSON.stringify({ type: 'text', text: '<svg onload="alert(1)"><rect/></svg>' }),
  JSON.stringify({ type: 'text', text: 'Normal conclusion text.' }),
].join('\n');

test('S01 — ResponseCleaner strips dangerous HTML from mocked LLM response', async ({
  authenticatedPage: page,
}) => {
  test.setTimeout(180_000);

  // Intercept the agentic-chat endpoint and return the malicious NDJSON
  await page.route('**/api/ai/agentic-chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/plain',
      body: MOCK_NDJSON,
    });
  });

  const inlineInput = await navigateToBookReader(page, BOOK_HASH);
  await inlineInput.click();
  await inlineInput.fill('Summarize this book.');
  await inlineInput.press('Enter');

  // Wait for "Normal conclusion text" to appear — confirms the stream was
  // consumed and the response rendered (malicious + benign parts processed).
  await expect
    .poll(
      async () => {
        const bodyText = await page.evaluate(() => document.body.innerText ?? '');
        return bodyText;
      },
      { timeout: 30_000, intervals: [500, 1000] },
    )
    .toMatch(/Normal conclusion text/i);

  // ---- Safety assertions ----
  // Scope checks to the assistant message area to avoid counting
  // Next.js framework <script> tags (page has ~184) and the EPUB <iframe>.
  const messageArea = await page.evaluate(() => {
    // Look for assistant message containers near the AI chat panel
    const candidates = document.querySelectorAll(
      '[class*="aui-assistant"], [class*="message"], [data-role="assistant"]',
    );
    let scriptInMessages = 0;
    let iframeInMessages = 0;
    for (const el of candidates) {
      scriptInMessages += el.querySelectorAll('script').length;
      iframeInMessages += el.querySelectorAll('iframe').length;
    }
    return { scriptInMessages, iframeInMessages };
  });

  // Also check if the raw <script> string appears literally in the rendered text
  // (React escapes it to &lt;script&gt; which shows as text, not as an element)
  const scriptCount = messageArea.scriptInMessages;
  console.log(`[S01] <script> elements in message area: ${scriptCount}`);

  const iframeCount = messageArea.iframeInMessages;
  console.log(`[S01] <iframe> elements in message area: ${iframeCount}`);

  // 3. No <img> elements with an onerror attribute
  const imgWithOnerrorCount = await page.locator('img[onerror]').count();
  console.log(`[S01] <img onerror> count: ${imgWithOnerrorCount}`);

  // 4. Verify benign text survived sanitization
  const bodyText = await page.evaluate(() => document.body.innerText ?? '');
  const benignSurvived = /Normal conclusion text/i.test(bodyText);
  console.log(`[S01] Benign text survived: ${benignSurvived}`);

  // 5. The raw string "<script>" must not appear in any assistant message's innerHTML.
  //    We check the rendered HTML of candidate message containers.
  const rawScriptTagPresent = await page.evaluate(() => {
    const candidates = Array.from(
      document.querySelectorAll(
        'div[class*="message"], div[class*="Message"], div[class*="assistant"], div[class*="thread"]',
      ),
    );
    return candidates.some((el) => el.innerHTML.includes('<script>'));
  });
  console.log(`[S01] Raw <script> in assistant message innerHTML: ${rawScriptTagPresent}`);

  console.log('\n===== S01 XSS RESPONSE CLEANER FINDINGS =====');
  console.log(`<script> DOM elements: ${scriptCount}`);
  console.log(`<iframe> DOM elements: ${iframeCount}`);
  console.log(`<img onerror> elements: ${imgWithOnerrorCount}`);
  console.log(`Benign text "Normal conclusion text" survived: ${benignSurvived}`);
  console.log(`Raw <script> tag in innerHTML: ${rawScriptTagPresent}`);
  console.log('==============================================\n');

  test.info().annotations.push(
    { type: 'S01-script-count', description: String(scriptCount) },
    { type: 'S01-iframe-count', description: String(iframeCount) },
    { type: 'S01-img-onerror-count', description: String(imgWithOnerrorCount) },
    { type: 'S01-benign-survived', description: String(benignSurvived) },
    { type: 'S01-raw-script-in-html', description: String(rawScriptTagPresent) },
    {
      type: 'finding',
      description: rawScriptTagPresent
        ? 'POTENTIAL XSS: raw <script> tag found in assistant message innerHTML'
        : scriptCount > 0 || iframeCount > 0 || imgWithOnerrorCount > 0
          ? `Dangerous elements present: script=${scriptCount} iframe=${iframeCount} img[onerror]=${imgWithOnerrorCount}`
          : 'ResponseCleaner correctly stripped all dangerous HTML; benign text survived',
    },
  );

  // javascript: URI links — common bypass in markdown renderers
  const jsLinkCount = await page.locator('a[href^="javascript:"]').count();
  console.log(`[S01] <a href="javascript:"> count: ${jsLinkCount}`);

  // SVG with event handlers
  const svgOnloadCount = await page.locator('svg[onload]').count();
  console.log(`[S01] <svg onload> count: ${svgOnloadCount}`);

  // Structural assertions — dangerous elements must not reach the DOM
  expect(scriptCount).toBe(0);
  expect(iframeCount).toBe(0);
  expect(imgWithOnerrorCount).toBe(0);
  expect(rawScriptTagPresent).toBe(false);
  expect(jsLinkCount).toBe(0);
  expect(svgOnloadCount).toBe(0);

  // Benign content must survive sanitization
  expect(benignSurvived).toBe(true);
});
