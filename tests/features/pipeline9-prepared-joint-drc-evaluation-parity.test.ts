import { expect, test } from "bun:test"
import { AutoroutingDrcEngine, type DrcEvaluator, type SimplifiedPcbTraces as RepairTraces } from "high-density-repair03/lib"
import { Pipeline9JointDrcRepairSolver, type Pipeline9AutoroutingDrcEngine } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { createPreparedJointDrcEvaluation, type Pipeline9PreparedIndexedDrcEvaluation, type Pipeline9PreparedJointDrcContext } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/createPreparedJointDrcEvaluation"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

type Params = ConstructorParameters<typeof Pipeline9JointDrcRepairSolver>[0]
type EvaluationCounters = {
  indexedDrcEvaluationCount: number
  indexedDrcCacheHitCount: number
  referenceDrcValidationCount: number
  referenceDrcFalseNegativeCount: number
}
const capturedTraces = new WeakMap<Pipeline9JointDrcRepairSolver, RepairTraces>()

class PreparedTestJoint extends Pipeline9JointDrcRepairSolver {
  pending = new Map<string, Pipeline9PreparedIndexedDrcEvaluation>()
  consumed = 0
  wrongCandidateKey = false

  protected override createAutoroutingDrcEngine(
    srj: ConstructorParameters<typeof AutoroutingDrcEngine>[0],
    options: ConstructorParameters<typeof AutoroutingDrcEngine>[1],
  ): Pipeline9AutoroutingDrcEngine {
    const original = super.createAutoroutingDrcEngine(srj, options)
    const owner = this
    return {
      evaluate(traces: RepairTraces): ReturnType<AutoroutingDrcEngine["evaluate"]> {
        capturedTraces.set(owner, structuredClone(traces))
        return original.evaluate(traces)
      },
      evaluateLegacy(traces: RepairTraces): ReturnType<AutoroutingDrcEngine["evaluateLegacy"]> {
        return original.evaluateLegacy(traces)
      },
      get lastRunStats(): AutoroutingDrcEngine["lastRunStats"] {
        return original.lastRunStats
      },
    }
  }

  protected override takePreparedIndexedDrcEvaluation(
    candidateKey: string,
    evaluatedRoutes: HighDensityRoute[],
  ): Pipeline9PreparedIndexedDrcEvaluation | undefined {
    void evaluatedRoutes
    const result = this.pending?.get(candidateKey)
    if (!result) return undefined
    this.pending.delete(candidateKey)
    this.consumed++
    return this.wrongCandidateKey ? { ...result, candidateKey: "wrong" } : result
  }

  context(): Pipeline9PreparedJointDrcContext {
    const result = this.getPreparedIndexedDrcContext()
    if (!result) throw new Error("Prepared Joint fixture did not enter repair")
    return result
  }

  evaluate(routes: HighDensityRoute[]): ReturnType<DrcEvaluator> {
    const evaluator = this.exactRepairSolver?.params.drcEvaluator
    if (!evaluator) throw new Error("Prepared Joint fixture is missing its exact evaluator")
    return evaluator({ traces: [], routes })
  }

  counters(): EvaluationCounters {
    const values = this as unknown as EvaluationCounters
    return {
      indexedDrcEvaluationCount: values.indexedDrcEvaluationCount,
      indexedDrcCacheHitCount: values.indexedDrcCacheHitCount,
      referenceDrcValidationCount: values.referenceDrcValidationCount,
      referenceDrcFalseNegativeCount: values.referenceDrcFalseNegativeCount,
    }
  }
}

function createParams(withPreload: boolean): Params {
  const routes: HighDensityRoute[] = [{
    connectionName: "horizontal", traceThickness: 0.1, viaDiameter: 0.3,
    route: [{ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }], vias: [],
  }]
  const horizontal = { name: "horizontal", pointsToConnect: [
    { x: -1, y: 0, layer: "top", pointId: "pcb_port_h0", pcb_port_id: "pcb_port_h0" },
    { x: 1, y: 0, layer: "top", pointId: "pcb_port_h1", pcb_port_id: "pcb_port_h1" },
  ] }
  const vertical = { name: "vertical", pointsToConnect: [
    { x: 0, y: -1, layer: "top", pointId: "pcb_port_v0", pcb_port_id: "pcb_port_v0" },
    { x: 0, y: 1, layer: "top", pointId: "pcb_port_v1", pcb_port_id: "pcb_port_v1" },
  ] }
  const preload: SimplifiedPcbTrace = {
    type: "pcb_trace", pcb_trace_id: "horizontal_0", connection_name: "vertical",
    connectsTo: ["pcb_port_v0", "pcb_port_v1"],
    route: [{ route_type: "wire", x: 0, y: -1, width: 0.1, layer: "top" },
      { route_type: "wire", x: 0, y: 1, width: 0.1, layer: "top" }],
  }
  if (!withPreload) routes.push({
    connectionName: "vertical", traceThickness: 0.1, viaDiameter: 0.3,
    route: [{ x: 0, y: -1, z: 0 }, { x: 0, y: 1, z: 0 }], vias: [],
  })
  const srj: SimpleRouteJson = {
    layerCount: 2, minTraceWidth: 0.1, bounds: { minX: -3, minY: -3, maxX: 3, maxY: 3 },
    connections: [horizontal, vertical], obstacles: [], traces: withPreload ? [preload] : [],
  }
  return {
    srj, srjWithPointPairs: srj, originalSrj: srj,
    newConnections: withPreload ? [horizontal] : srj.connections, newHdRoutes: routes,
    updatedPreloadedTraces: withPreload ? [preload] : [], mutatedPreloadedTraceIds: new Set(),
    connMap: getConnectivityMapFromSimpleRouteJson(srj), obstacles: srj.obstacles,
    layerCount: 2, defaultViaDiameter: 0.3, defaultViaHoleDiameter: 0.15, effort: 1, colorMap: {},
  }
}

test("prepared worker DRC preserves preload ownership, consumed cache counters and reference-zero validation", (): void => {
  for (const withPreload of [false, true]) {
    const native = new PreparedTestJoint(createParams(withPreload))
    const adopted = new PreparedTestJoint(createParams(withPreload))
    const context = adopted.context()
    const originalContext = structuredClone(context)
    const worker = createPreparedJointDrcEvaluation(context)
    let zeroResults = 0
    expect(context.movablePreloadedSections.length > 0).toBe(withPreload)
    const inputRoutes = adopted.exactRepairSolver!.params.hdRoutes as HighDensityRoute[]
    for (let trial = 0; trial < 10; trial++) {
      const candidate = structuredClone(inputRoutes)
      candidate[0]!.route.splice(1, 0, { x: 0.1 + trial * 0.01, y: trial < 5 ? 0.1 : 1.5, z: trial === 9 ? 1 : 0 })
      const before = adopted.counters()
      const prepared = worker.evaluate(candidate)
      expect(adopted.counters()).toEqual(before)
      expect(context).toEqual(originalContext)
      adopted.pending.set(prepared.candidateKey, structuredClone(prepared))
      const expected = native.evaluate(candidate)
      expect(prepared.preparedCandidateDrcInput.evaluatedTraces).toEqual(capturedTraces.get(native)!)
      const actual = adopted.evaluate(candidate)
      expect(actual).toEqual(expected)
      expect(adopted.counters()).toEqual(native.counters())
      if (prepared.evaluatedDrc.errors.length === 0) {
        zeroResults++
        expect(adopted.counters().referenceDrcValidationCount).toBe(before.referenceDrcValidationCount + 1)
      }
      const consumed = adopted.consumed
      adopted.pending.set(prepared.candidateKey, structuredClone(prepared))
      const cached = adopted.evaluate(structuredClone(candidate))
      expect(cached).toBe(actual)
      expect(adopted.consumed).toBe(consumed)
      expect(adopted.pending.has(prepared.candidateKey)).toBe(true)
      expect(native.evaluate(candidate)).toBe(expected)
      expect(adopted.counters()).toEqual(native.counters())
      adopted.pending.clear()
    }
    expect(adopted.consumed).toBe(10)
    expect(zeroResults).toBeGreaterThan(0)
    expect(adopted.counters().referenceDrcValidationCount).toBeGreaterThan(0)
    const badCandidate = structuredClone(inputRoutes)
    badCandidate[0]!.route[0]!.x -= 0.017
    const badResult = worker.evaluate(badCandidate)
    adopted.pending.set(badResult.candidateKey, badResult)
    adopted.wrongCandidateKey = true
    expect(() => adopted.evaluate(badCandidate)).toThrow("does not match its consumed candidate")
    if (withPreload) {
      expect(() => worker.evaluate(badCandidate.filter((route) => !route.connectionName.startsWith("pipeline9_preloaded_drc_"))))
        .toThrow("lost preloaded section")
    }
  }
})
