import { test } from "bun:test";
import { Effect, TestServices } from "effect";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

interface HarEntry {
  request: {
    method: string;
    url: string;
    headers: Array<{ name: string; value: string }>;
    postData?: { text: string };
  };
  response: {
    status: number;
    statusText: string;
    headers: Array<{ name: string; value: string }>;
    content: { text: string; mimeType: string };
  };
}

interface HarFile {
  log: { entries: HarEntry[] };
}

const SENSITIVE_HEADERS = new Set([
  "authorization",
  "x-api-key",
  "x-goog-api-key",
  "anthropic-organization-id",
  "cookie",
]);

function redactHeaders(
  headers: Array<{ name: string; value: string }>,
): Array<{ name: string; value: string }> {
  return headers.map((header) =>
    SENSITIVE_HEADERS.has(header.name.toLowerCase())
      ? { name: header.name, value: "[REDACTED]" }
      : header,
  );
}

function fingerprint(method: string, url: string, body: string): string {
  return createHash("sha256")
    .update(`${method}\n${url}\n${body}`)
    .digest("hex");
}

function loadHar(filePath: string): HarFile | null {
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf-8")) as HarFile;
}

function saveHar(filePath: string, har: HarFile): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(har, null, 2));
}

function createRecordingFetch(
  cassettePath: string,
  originalFetch: typeof globalThis.fetch,
): { patch: () => void; unpatch: () => void; flush: () => void } {
  const har = loadHar(cassettePath);
  const entryMap = new Map<string, HarEntry>();
  const newEntries: HarEntry[] = [];

  if (har) {
    for (const entry of har.log.entries) {
      const fp = fingerprint(
        entry.request.method,
        entry.request.url,
        entry.request.postData?.text ?? "",
      );
      entryMap.set(fp, entry);
    }
  }

  async function intercept(
    input: Parameters<typeof globalThis.fetch>[0],
    init?: Parameters<typeof globalThis.fetch>[1],
  ): Promise<Response> {
    const request = new Request(
      input instanceof Request ? input.url : String(input),
      init ?? (input instanceof Request ? input : undefined),
    );
    const method = request.method;
    const url = request.url;
    const body = await request.clone().text();
    const fp = fingerprint(method, url, body);

    const cached = entryMap.get(fp);
    if (cached) {
      const headers = new Headers();
      for (const header of cached.response.headers) {
        headers.set(header.name, header.value);
      }
      return new Response(cached.response.content.text, {
        status: cached.response.status,
        statusText: cached.response.statusText,
        headers,
      });
    }

    const response = await originalFetch(input, init);
    const responseBody = await response.clone().text();
    const requestHeaders: Array<{ name: string; value: string }> = [];
    request.headers.forEach((value, name) => {
      requestHeaders.push({ name, value });
    });
    const responseHeaders: Array<{ name: string; value: string }> = [];
    response.headers.forEach((value, name) => {
      responseHeaders.push({ name, value });
    });

    const entry: HarEntry = {
      request: {
        method,
        url,
        headers: redactHeaders(requestHeaders),
        ...(body ? { postData: { text: body } } : {}),
      },
      response: {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        content: {
          text: responseBody,
          mimeType: response.headers.get("content-type") ?? "application/json",
        },
      },
    };

    if (response.ok) {
      newEntries.push(entry);
      entryMap.set(fp, entry);
    }

    return response;
  }

  const flush = () => {
    if (newEntries.length === 0) return;
    const allEntries = har ? [...har.log.entries] : [];
    for (const entry of newEntries) {
      const fp = fingerprint(
        entry.request.method,
        entry.request.url,
        entry.request.postData?.text ?? "",
      );
      const existingIndex = allEntries.findIndex(
        (candidate) =>
          fingerprint(
            candidate.request.method,
            candidate.request.url,
            candidate.request.postData?.text ?? "",
          ) === fp,
      );
      if (existingIndex >= 0) {
        allEntries[existingIndex] = entry;
      } else {
        allEntries.push(entry);
      }
    }
    saveHar(cassettePath, { log: { entries: allEntries } });
  };

  const patch = () => {
    Object.assign(intercept, originalFetch);
    globalThis.fetch = intercept as typeof globalThis.fetch;
  };
  const unpatch = () => {
    globalThis.fetch = originalFetch;
  };

  return { patch, unpatch, flush };
}

function toRecordingName(testName: string): string {
  return testName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function toFsSafeName(name: string): string {
  return name.replace(/:/g, "_");
}

type TestOptions = { timeout?: number };
type EffectFn<A, E> = () => Effect.Effect<A, E, TestServices.TestServices>;

export interface RecordConfig {
  readonly id: string;
  readonly [key: string]: unknown;
}

export type RecordTester = {
  <A, E>(
    name: string,
    fn: EffectFn<A, E>,
    options?: number | TestOptions,
  ): void;
  skip: <A, E>(
    name: string,
    fn: EffectFn<A, E>,
    options?: number | TestOptions,
  ) => void;
  each: <T extends RecordConfig>(
    configs: readonly T[],
  ) => (
    name: string,
    fn: (
      config: T,
    ) => Effect.Effect<unknown, unknown, TestServices.TestServices>,
    options?: number | TestOptions,
  ) => void;
};

function makeRecordTest(
  cassettesDir: string,
  namespace: string,
  runner: typeof test,
) {
  return <A, E>(
    name: string,
    fn: EffectFn<A, E>,
    options?: number | TestOptions,
  ) => {
    const timeout = typeof options === "number" ? options : options?.timeout;
    runner(
      name,
      async () => {
        const cassettePath = join(
          cassettesDir,
          namespace,
          `${toRecordingName(name)}.har`,
        );
        const { patch, unpatch, flush } = createRecordingFetch(
          cassettePath,
          globalThis.fetch,
        );
        patch();
        try {
          await Effect.runPromise(
            fn().pipe(Effect.provide(TestServices.liveServices)),
          );
        } finally {
          unpatch();
          flush();
        }
      },
      timeout ? { timeout } : undefined,
    );
  };
}

function makeRecordEach(
  cassettesDir: string,
  namespace: string,
  runner: typeof test,
) {
  return <T extends RecordConfig>(configs: readonly T[]) =>
    (
      name: string,
      fn: (
        config: T,
      ) => Effect.Effect<unknown, unknown, TestServices.TestServices>,
      options?: number | TestOptions,
    ) => {
      const timeout = typeof options === "number" ? options : options?.timeout;
      for (const config of configs) {
        runner(
          `[${config.id}] ${name}`,
          async () => {
            const cassettePath = join(
              cassettesDir,
              namespace,
              toFsSafeName(config.id),
              `${toRecordingName(name)}.har`,
            );
            const { patch, unpatch, flush } = createRecordingFetch(
              cassettePath,
              globalThis.fetch,
            );
            patch();
            try {
              await Effect.runPromise(
                fn(config).pipe(Effect.provide(TestServices.liveServices)),
              );
            } finally {
              unpatch();
              flush();
            }
          },
          timeout ? { timeout } : undefined,
        );
      }
    };
}

export function createRecordIt(
  testDir: string,
  namespace: string,
): RecordTester {
  const cassettesDir = join(testDir, "cassettes");
  const base = makeRecordTest(cassettesDir, namespace, test);
  return Object.assign(base, {
    skip: makeRecordTest(cassettesDir, namespace, test.skip),
    each: makeRecordEach(cassettesDir, namespace, test),
  }) as RecordTester;
}
