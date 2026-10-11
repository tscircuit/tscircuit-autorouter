import { expect, test } from "bun:test"
import { checkTracesAreContiguous } from "@tscircuit/checks"
import type { AnyCircuitElement } from "circuit-json"
import { getDrcErrors } from "../../lib/testing/getDrcErrors"
import { evaluateRelaxedDrc } from "../../lib/testing/evaluate-relaxed-drc"
import { createMemoizedReferenceDrcEvaluator } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/createMemoizedReferenceDrcEvaluator"
import { ReferenceDrcPrimitiveMemo } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/ReferenceDrcPrimitiveMemo"
import type { SimpleRouteJson } from "../../lib/types"

test("authoritative continuity injection preserves native check order, exceptions, full result and disabled continuity", () => {
  let calls = 0
  const circuit: AnyCircuitElement[] = []
  const checker = (input: AnyCircuitElement[]): ReturnType<typeof checkTracesAreContiguous> => {
    expect(input).toBe(circuit)
    calls++
    return checkTracesAreContiguous(input)
  }
  expect(getDrcErrors(circuit, { traceContinuityChecker: checker })).toEqual(getDrcErrors(circuit))
  expect(calls).toBe(1)
  getDrcErrors(circuit, { traceContinuityChecker: checker, includeTraceContinuity: false })
  expect(calls).toBe(1)
  const nativeError = new RangeError("native route access before continuity")
  const trace = { type: "pcb_trace", pcb_trace_id: "malformed", source_trace_id: "source" }
  Object.defineProperty(trace, "route", { get: (): never => { throw nativeError }, enumerable: true })
  const malformed = [trace] as AnyCircuitElement[]
  const capture = (run: () => unknown): unknown => {
    try { run() } catch (error) { return error }
    throw new Error("Expected the native malformed-input failure")
  }
  expect(capture(() => getDrcErrors(malformed))).toBe(nativeError)
  expect(capture(() => getDrcErrors(malformed, { traceContinuityChecker: (): never => { calls++; throw new Error("later continuity") } }))).toBe(nativeError)
  expect(calls).toBe(1)
  const srj: SimpleRouteJson = {
    layerCount: 2, minTraceWidth: .1,
    bounds: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
    connections: [{ name: "n", pointsToConnect: [{x:-1,y:0,layer:"top",pcb_port_id:"p1"},{x:1,y:0,layer:"top",pcb_port_id:"p2"}] }],
    obstacles: [{type:"rect",center:{x:-1,y:0},width:.3,height:.3,layers:["top"],connectedTo:["p1"]},{type:"rect",center:{x:1,y:0},width:.3,height:.3,layers:["top"],connectedTo:["p2"]}],
  }
  const input = { inputSrj: srj, srjWithPointPairs: srj, includeBoardClearance: true,
    routedTraces: [{type:"pcb_trace" as const,pcb_trace_id:"trace",connection_name:"n",route:[{route_type:"wire" as const,x:-1,y:0,width:.1,layer:"top"},{route_type:"wire" as const,x:1,y:0,width:.1,layer:"top"}]}] }
  const memo = new ReferenceDrcPrimitiveMemo()
  const evaluate = createMemoizedReferenceDrcEvaluator(memo)
  for (const includeTraceContinuity of [true, false, true]) {
    const evaluation = { ...input, drcOptions: { includeTraceContinuity } }
    expect(evaluate(evaluation)).toEqual(evaluateRelaxedDrc(evaluation))
    expect(evaluate(evaluation)).toEqual(evaluateRelaxedDrc(evaluation))
  }
  input.routedTraces[0].route[1].x = .5
  expect(evaluate(input)).toEqual(evaluateRelaxedDrc(input))
  input.routedTraces[0].route[1].x = 1
  expect(evaluate(input)).toEqual(evaluateRelaxedDrc(input))
  expect(memo.diagnostics.hits).toBeGreaterThan(0)
})
