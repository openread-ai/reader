// apps/openread-app/e2e/_fixtures/mock-figma.ts
//
// Deterministic Figma MCP mock fixture (§3 Bundle C, C3).
//
// Bundle G (design pipeline) integrates with the Figma MCP server for:
//   - figma-mcp-drafter agent
//   - baseline-exporter agent
//   - tokens-sync script
//
// For test determinism we replace those live MCP calls with a hand-rolled
// mock that returns canned design-context payloads keyed by nodeId.
//
// TODO: once Bundle G defines the real MCP-call surface, expand this mock
//       to include: get_design_context, get_screenshot, get_variable_defs,
//       get_metadata, send_code_connect_mappings.

export type MockFigmaFixture = {
  /**
   * Register a canned response for a given (fileKey, nodeId) pair.
   */
  stub: (fileKey: string, nodeId: string, response: MockFigmaResponse) => void;
  /**
   * Simulate a `get_design_context` call — returns either a registered
   * stub or a deterministic default payload.
   */
  getDesignContext: (fileKey: string, nodeId: string) => Promise<MockFigmaResponse>;
  /**
   * Number of MCP calls observed during the test (for assertion).
   */
  callCount: () => number;
};

export type MockFigmaResponse = {
  code: string;
  screenshotUrl: string;
  tokens: Record<string, string>;
  // TODO: extend with Code Connect hints + annotations once G1 solidifies.
};

// Playwright parses the first parameter to detect fixture dependencies — it
// MUST be an object-destructuring pattern even when no built-in fixtures are
// consumed. See: https://playwright.dev/docs/test-fixtures#creating-a-fixture
export const mockFigmaFixture = async (
  {}: Record<string, never>,
  // Playwright's fixture callback is conventionally named `use`. We alias it
  // to `provide` to avoid eslint-plugin-react-hooks misidentifying the call
  // as React's `use()` hook (these files are pure Playwright, never React).
  provide: (value: MockFigmaFixture) => Promise<void>,
) => {
  const stubs = new Map<string, MockFigmaResponse>();
  let count = 0;

  const key = (fileKey: string, nodeId: string) => `${fileKey}::${nodeId}`;

  const fixture: MockFigmaFixture = {
    stub: (fileKey, nodeId, response) => {
      stubs.set(key(fileKey, nodeId), response);
    },
    getDesignContext: async (fileKey, nodeId) => {
      count += 1;
      const cached = stubs.get(key(fileKey, nodeId));
      if (cached) return cached;
      // Default deterministic payload.
      return {
        code: `<div data-figma-node="${nodeId}" />`,
        screenshotUrl: `mock://figma/${fileKey}/${nodeId}.png`,
        tokens: {},
      };
    },
    callCount: () => count,
  };

  await provide(fixture);

  // No external resources — nothing to tear down.
};
