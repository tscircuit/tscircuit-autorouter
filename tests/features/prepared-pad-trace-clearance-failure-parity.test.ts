import { expect, test } from "bun:test"
import { checkPadTraceClearance } from "@tscircuit/checks"
import type { AnyCircuitElement, PcbTrace } from "circuit-json"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPreparedPadTraceClearanceChecker } from "lib/testing/utils/createPreparedPadTraceClearanceChecker"

test("prepared pad checks preserve native accessor reads and malformed input failures", (): void => {
  type Fixture = {
    input: AnyCircuitElement[]
    metadata: AnyCircuitElement
    trace: PcbTrace
  }
  const createFixture = (): Fixture => {
    const metadata: AnyCircuitElement = {
      type: "source_component",
      source_component_id: "unused-source",
      name: "U-unused",
      ftype: "simple_chip",
    }
    const trace: PcbTrace = {
      type: "pcb_trace",
      pcb_trace_id: "signal",
      route: [-1, 1].map((x): PcbTrace["route"][number] => ({
        route_type: "wire",
        x,
        y: 0,
        width: 0.1,
        layer: "top",
      })),
    }
    return {
      metadata,
      trace,
      input: [
        metadata,
        trace,
        {
          type: "pcb_smtpad",
          pcb_smtpad_id: "pad",
          pcb_component_id: "foreign-component",
          pcb_port_id: "foreign-port",
          shape: "rect",
          x: 0,
          y: 0.2,
          width: 0.2,
          height: 0.2,
          layer: "top",
        },
      ],
    }
  }
  const getFailure = (
    operation: () => unknown,
  ): { name: string; message: string } => {
    try {
      operation()
    } catch (error) {
      if (!(error instanceof Error)) throw error
      return { name: error.name, message: error.message }
    }
    throw new Error("The malformed fixture must fail natively")
  }
  const options = { connMap: new ConnectivityMap({}), minClearance: 0.1 }
  const prepared = createPreparedPadTraceClearanceChecker()
  const nativeGetter = createFixture()
  const preparedGetter = createFixture()
  let nativeReads = 0
  let preparedReads = 0
  Object.defineProperty(nativeGetter.metadata, "source_component_id", {
    enumerable: true,
    configurable: true,
    get: (): string => {
      nativeReads++
      return "unused-source"
    },
  })
  Object.defineProperty(preparedGetter.metadata, "source_component_id", {
    enumerable: true,
    configurable: true,
    get: (): string => {
      preparedReads++
      return "unused-source"
    },
  })
  for (let iteration = 0; iteration < 2; iteration++) {
    const expected = checkPadTraceClearance(nativeGetter.input, options)
    expect(expected).toHaveLength(1)
    expect(prepared(preparedGetter.input, options)).toEqual(expected)
    expect(preparedReads).toBe(nativeReads)
  }
  expect(nativeReads).toBeGreaterThan(0)
  expect(prepared.getStats().cacheEligibleEvaluationCount).toBe(0)
  expect(prepared.getStats().nativeInvocationCount).toBe(2)

  const nativeOptionFixture = createFixture()
  const preparedOptionFixture = createFixture()
  let nativeOptionReads = 0
  let preparedOptionReads = 0
  const nativeOptions = {
    connMap: options.connMap,
    get minClearance(): number {
      nativeOptionReads++
      return 0.1
    },
  }
  const preparedOptions = {
    connMap: options.connMap,
    get minClearance(): number {
      preparedOptionReads++
      return 0.1
    },
  }
  expect(prepared(preparedOptionFixture.input, preparedOptions)).toEqual(
    checkPadTraceClearance(nativeOptionFixture.input, nativeOptions),
  )
  expect(preparedOptionReads).toBe(nativeOptionReads)
  expect(nativeOptionReads).toBe(1)
  expect(prepared.getStats().cacheEligibleEvaluationCount).toBe(0)

  // Native CJU initializes primary-ID counts only on its first array use.
  // A later non-string ID must not cause fresh miss-array initialization.
  const nativeInitialized = createFixture()
  const preparedInitialized = createFixture()
  const expected = checkPadTraceClearance(nativeInitialized.input, options)
  expect(prepared(preparedInitialized.input, options)).toEqual(expected)
  for (const fixture of [nativeInitialized, preparedInitialized]) {
    Object.defineProperty(fixture.metadata, "source_component_id", {
      value: 99,
      enumerable: true,
      configurable: true,
      writable: true,
    })
  }
  expect(checkPadTraceClearance(nativeInitialized.input, options)).toEqual(
    expected,
  )
  const beforeInitialized = prepared.getStats()
  expect(prepared(preparedInitialized.input, options)).toEqual(expected)
  expect(prepared.getStats().nativeInvocationCount).toBe(
    beforeInitialized.nativeInvocationCount + 1,
  )
  expect(prepared.getStats().cacheEligibleEvaluationCount).toBe(
    beforeInitialized.cacheEligibleEvaluationCount,
  )

  const nativeMalformed = createFixture()
  const preparedMalformed = createFixture()
  for (const fixture of [nativeMalformed, preparedMalformed]) {
    Object.defineProperty(fixture.metadata, "source_component_id", {
      value: 99,
      enumerable: true,
    })
  }
  const nativeFailure = getFailure(() =>
    checkPadTraceClearance(nativeMalformed.input, options),
  )
  expect(nativeFailure.name).toBe("TypeError")
  expect(
    getFailure(() => prepared(preparedMalformed.input, options)),
  ).toEqual(nativeFailure)

  // A successful cached result never replaces a failing new trace geometry.
  const nativeBadRoute = createFixture()
  const preparedBadRoute = createFixture()
  const saved = prepared(preparedBadRoute.input, options)
  const savedSnapshot = structuredClone(saved)
  for (const fixture of [nativeBadRoute, preparedBadRoute]) {
    Object.defineProperty(fixture.trace.route, "1", { value: null })
  }
  expect(
    getFailure(() => prepared(preparedBadRoute.input, options)),
  ).toEqual(
    getFailure(() => checkPadTraceClearance(nativeBadRoute.input, options)),
  )
  expect(saved).toEqual(savedSnapshot)

  const frozenNative = createFixture()
  const frozenPrepared = createFixture()
  expect(prepared(createFixture().input, options)).toHaveLength(1)
  Object.freeze(frozenNative.input)
  Object.freeze(frozenPrepared.input)
  // A new frozen array cannot receive the native setup bookkeeping. A prior
  // matching cache entry must not suppress that original-array exception.
  expect(
    getFailure(() => prepared(frozenPrepared.input, options)),
  ).toEqual(
    getFailure(() => checkPadTraceClearance(frozenNative.input, options)),
  )
})
