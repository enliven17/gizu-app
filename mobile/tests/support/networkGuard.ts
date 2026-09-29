// Only rendered journeys use this guard. Adapter tests own their fetch mocks.
if (expect.getState().testPath?.includes("functional")) {
  let originalFetch: typeof fetch;
  let attempts: string[];
  beforeEach(() => {
    attempts = [];
    originalFetch = global.fetch;
    global.fetch = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockImplementation(async (input) => {
        attempts.push(String(input));
        throw new Error("Unexpected network request: inject a test service.");
      });
  });
  afterEach(() => {
    global.fetch = originalFetch;
    // A UI may catch the rejection; still fail the test on an attempted request.
    expect(attempts).toEqual([]);
  });
}
