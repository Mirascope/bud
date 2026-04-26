import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  setSystemTime,
  spyOn,
  test,
} from "bun:test";
import { Effect, TestServices } from "effect";
import type { Scope } from "effect";

export {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  setSystemTime,
  spyOn,
};

type TestOptions = { timeout?: number };

const runTest = <E, A>(
  effect: Effect.Effect<A, E, TestServices.TestServices>,
) => Effect.runPromise(effect.pipe(Effect.provide(TestServices.liveServices)));

const runTestScoped = <E, A>(
  effect: Effect.Effect<A, E, TestServices.TestServices | Scope.Scope>,
) =>
  Effect.runPromise(
    effect.pipe(Effect.scoped, Effect.provide(TestServices.liveServices)),
  );

type EffectFn<A, E, R> = () => Effect.Effect<A, E, R>;

type EffectTester = {
  <A, E>(
    name: string,
    fn: EffectFn<A, E, TestServices.TestServices>,
    options?: number | TestOptions,
  ): void;
  skip: <A, E>(
    name: string,
    fn: EffectFn<A, E, TestServices.TestServices>,
    options?: number | TestOptions,
  ) => void;
};

type ScopedTester = {
  <A, E>(
    name: string,
    fn: EffectFn<A, E, TestServices.TestServices | Scope.Scope>,
    options?: number | TestOptions,
  ): void;
  skip: <A, E>(
    name: string,
    fn: EffectFn<A, E, TestServices.TestServices | Scope.Scope>,
    options?: number | TestOptions,
  ) => void;
};

const makeEffectTest =
  (runner: typeof test) =>
  <A, E>(
    name: string,
    fn: EffectFn<A, E, TestServices.TestServices>,
    options?: number | TestOptions,
  ) => {
    const timeout = typeof options === "number" ? options : options?.timeout;
    runner(name, () => runTest(fn()), timeout ? { timeout } : undefined);
  };

const makeScopedTest =
  (runner: typeof test) =>
  <A, E>(
    name: string,
    fn: EffectFn<A, E, TestServices.TestServices | Scope.Scope>,
    options?: number | TestOptions,
  ) => {
    const timeout = typeof options === "number" ? options : options?.timeout;
    runner(name, () => runTestScoped(fn()), timeout ? { timeout } : undefined);
  };

export const effect: EffectTester = Object.assign(makeEffectTest(test), {
  skip: makeEffectTest(test.skip),
});

export const scoped: ScopedTester = Object.assign(makeScopedTest(test), {
  skip: makeScopedTest(test.skip),
});

export const it = Object.assign(test, { effect, scoped });

export { createFetchMock } from "./fetch-mock.ts";
export {
  createRecordIt,
  type RecordConfig,
  type RecordTester,
} from "./recorder.ts";
