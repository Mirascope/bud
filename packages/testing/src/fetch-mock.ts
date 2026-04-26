export type CapturedRequest = [
  input: Parameters<typeof fetch>[0],
  init?: RequestInit,
];

export function createFetchMock() {
  let originalFetch: typeof globalThis.fetch;
  let fetchQueue: Array<{ resolve?: Response; reject?: Error }> = [];
  let capturedRequests: CapturedRequest[] = [];

  const fetchImpl = (...args: Parameters<typeof fetch>): Promise<Response> => {
    capturedRequests.push([args[0], args[1]]);
    const next = fetchQueue.shift();
    if (next?.reject) return Promise.reject(next.reject);
    if (next?.resolve) return Promise.resolve(next.resolve);
    return Promise.resolve(new Response());
  };

  return {
    mockResolve(response: Response) {
      fetchQueue.push({ resolve: response });
    },
    mockReject(error: Error) {
      fetchQueue.push({ reject: error });
    },
    get requests(): ReadonlyArray<CapturedRequest> {
      return capturedRequests;
    },
    setup() {
      originalFetch = globalThis.fetch;
      fetchQueue = [];
      capturedRequests = [];
      globalThis.fetch = fetchImpl as typeof fetch;
    },
    teardown() {
      globalThis.fetch = originalFetch;
    },
  };
}
