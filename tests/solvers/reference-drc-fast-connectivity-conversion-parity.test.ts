import { expect, test } from "bun:test"
import { deepStrictEqual } from "node:assert"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  evaluateRelaxedDrc,
  type EvaluateRelaxedDrcInput,
} from "../../lib/testing/evaluate-relaxed-drc"
import {
  convertToCircuitJson,
  type ConvertToCircuitJsonOptions,
} from "../../lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "../../lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "../../lib/utils/getConnectivityMapFromSimpleRouteJson"
import { getParallelConnectivityMap } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/getParallelConnectivityMap"
import { createMemoizedReferenceDrcEvaluator } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/createMemoizedReferenceDrcEvaluator"

function captureException(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  throw new Error("Expected the native conversion failure")
}

test("fast reference connectivity preserves full sample015 conversion, live inventory, supplied maps and native exception sites", (): void => {
  const input = JSON.parse(gunzipSync(new Uint8Array(readFileSync(new URL(
    "../fixtures/reference-drc-srj18/sample015-constructor-input.json.gz",
    import.meta.url,
  )))).toString()) as EvaluateRelaxedDrcInput
  expect(input.connectivityMaps).toBeUndefined()
  expect(input.routedTraces).toHaveLength(461)
  const evaluate = createMemoizedReferenceDrcEvaluator()
  for (const routedTraces of [[], input.routedTraces]) {
    const evaluation = { ...input, routedTraces }
    deepStrictEqual(evaluate(evaluation), evaluateRelaxedDrc(evaluation))
  }

  const calls: SimpleRouteJson[] = []
  const factory = (srj: SimpleRouteJson): ConnectivityMap => {
    calls.push(srj)
    const native = getConnectivityMapFromSimpleRouteJson(srj)
    const fast = getParallelConnectivityMap(srj)
    deepStrictEqual(fast.netMap, native.netMap)
    deepStrictEqual(fast.idToNetMap, native.idToNetMap)
    deepStrictEqual(Object.keys(fast.netMap), Object.keys(native.netMap))
    return fast
  }
  const options: ConvertToCircuitJsonOptions = {
    originalSrj: input.inputSrj,
    includeOriginalConnections: true,
    minTraceWidth: input.inputSrj.minTraceWidth,
    minViaDiameter: input.inputSrj.minViaDiameter,
  }
  const first = convertToCircuitJson(input.srjWithPointPairs, input.routedTraces, options)
  deepStrictEqual(
    convertToCircuitJson(input.srjWithPointPairs, input.routedTraces, { ...options, connectivityMapFactory: factory }),
    first,
  )
  expect(calls).toHaveLength(2)
  expect(calls[0]!.obstacles).toBe(input.inputSrj.obstacles)
  expect(calls[0]!.connections).toEqual([
    ...input.srjWithPointPairs.connections,
    ...input.inputSrj.connections,
  ])
  expect(calls[1]).toBe(input.srjWithPointPairs)

  const point = input.inputSrj.connections[0]!.pointsToConnect[0]!
  const obstacle = input.inputSrj.obstacles[0]!
  const savedPointId = point.pcb_port_id
  const savedOffboard = obstacle.offBoardConnectsTo
  point.pcb_port_id = "changed_original_port"
  obstacle.offBoardConnectsTo = ["changed_offboard_net"]
  const mutated = convertToCircuitJson(input.srjWithPointPairs, input.routedTraces, options)
  deepStrictEqual(
    convertToCircuitJson(input.srjWithPointPairs, input.routedTraces, { ...options, connectivityMapFactory: factory }),
    mutated,
  )
  expect(mutated).not.toEqual(first)
  expect(calls).toHaveLength(4)
  point.pcb_port_id = savedPointId
  obstacle.offBoardConnectsTo = savedOffboard
  deepStrictEqual(evaluate(input), evaluateRelaxedDrc(input))

  const suppliedMaps = { source: factory(calls[0]!), route: factory(input.srjWithPointPairs) }
  let suppliedCalls = 0
  const suppliedFactory = (): never => {
    suppliedCalls++
    throw new Error("Supplied connectivity maps must bypass construction")
  }
  deepStrictEqual(
    convertToCircuitJson(input.srjWithPointPairs, input.routedTraces, { ...options, connectivityMaps: suppliedMaps, connectivityMapFactory: suppliedFactory }),
    convertToCircuitJson(input.srjWithPointPairs, input.routedTraces, { ...options, connectivityMaps: suppliedMaps }),
  )
  expect(suppliedCalls).toBe(0)

  const trace = input.routedTraces[0]!
  const beforeMapError = new RangeError("route identity read before source-map construction")
  const earlyTrace = { ...trace }
  Object.defineProperty(earlyTrace, "connection_name", { get: (): never => { throw beforeMapError } })
  const callsBeforeEarlyError = calls.length
  expect(captureException(() => convertToCircuitJson(input.srjWithPointPairs, [earlyTrace], options))).toBe(beforeMapError)
  expect(captureException(() => convertToCircuitJson(input.srjWithPointPairs, [earlyTrace], { ...options, connectivityMapFactory: factory }))).toBe(beforeMapError)
  expect(calls.length).toBe(callsBeforeEarlyError)

  const afterSourceError = new RangeError("route geometry read after source-map construction")
  const malformedTrace = { ...trace }
  Object.defineProperty(malformedTrace, "route", { get: (): never => { throw afterSourceError } })
  const callsBeforeSourceError = calls.length
  expect(captureException(() => convertToCircuitJson(input.srjWithPointPairs, [malformedTrace], options))).toBe(afterSourceError)
  expect(captureException(() => convertToCircuitJson(input.srjWithPointPairs, [malformedTrace], { ...options, connectivityMapFactory: factory }))).toBe(afterSourceError)
  expect(calls.length).toBe(callsBeforeSourceError + 1)

  const single: SimpleRouteJson = {
    layerCount: 2, minTraceWidth: .1,
    bounds: { minX: -1, minY: -1, maxX: 1, maxY: 1 },
    obstacles: [], connections: [],
  }
  const route: SimplifiedPcbTrace = { type: "pcb_trace", pcb_trace_id: "empty", connection_name: "undeclared", route: [] }
  deepStrictEqual(convertToCircuitJson(single, [route], { connectivityMapFactory: factory }), convertToCircuitJson(single, [route]))
  expect(calls.at(-2)).toBe(single)
  expect(calls.at(-1)).toBe(single)
})
