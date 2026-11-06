import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { checkTracesAreContiguous } from "@tscircuit/checks"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { canonicalizePipeline9HdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/canonicalizePipeline9HdRoutes"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { getViaDimensions } from "lib/utils/getViaDimensions"

test("the existing exact stage finishes OrangeCrab's private one-error regional candidate", (): void => {
  // Real post-global routing output: the first bounded pass reaches one peer
  // clearance error but cannot publish incomplete coupled geometry.
  const fixture: {
    originalSrj: SimpleRouteJson
    pairedSrj: SimpleRouteJson
    routes: HighDensityRoute[]
    originalRoutes: HighDensityRoute[]
    connections: SimpleRouteConnection[]
  } = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/assets/orangecrab-through-vias/stalled-joint-input.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  )
  const physicalReference: SimpleRouteJson = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/assets/orangecrab-through-vias/physical-reference.srj.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  )
  const original = JSON.stringify(fixture)
  const fixedReference = JSON.stringify(physicalReference.traces)
  const connMap = getConnectivityMapFromSimpleRouteJson(fixture.originalSrj)
  const via = getViaDimensions(fixture.originalSrj)
  const params = {
    srj: fixture.pairedSrj,
    srjWithPointPairs: fixture.pairedSrj,
    originalSrj: fixture.originalSrj,
    newConnections: fixture.connections,
    newHdRoutes: fixture.routes,
    originalNewHdRoutes: fixture.originalRoutes,
    updatedPreloadedTraces: [],
    mutatedPreloadedTraceIds: new Set<string>(),
    connMap,
    obstacles: fixture.originalSrj.obstacles,
    layerCount: fixture.originalSrj.layerCount,
    defaultViaDiameter: via.padDiameter,
    defaultViaHoleDiameter: via.holeDiameter,
    effort: 1,
    colorMap: {},
  }
  const solver = new Pipeline9JointDrcRepairSolver(params)
  solver.solve()
  expect(solver.failed, solver.error ?? "").toBeFalse()
  expect(solver.solved).toBeTrue()
  expect(solver.stats.initialBoundedRegionalRepairAccepted).toBeFalse()
  expect(solver.stats.initialBoundedRegionalRepairSeedDrcIssueCount).toBe(1)
  expect(solver.exactRepairSolver!.stats.initialDrcIssueCount).toBe(1)
  expect(solver.exactRepairSolver!.stats.finalDrcIssueCount).toBe(0)
  expect(solver.exactRepairSolver!.params.maxIterations).toBe(32)
  expect(solver.regionalB01RepairSolver).toBeUndefined()
  expect(solver.boundedRegionalRepairSolver).toBeUndefined()
  const traces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
    hdRoutes: canonicalizePipeline9HdRoutes(solver.getOutput()),
    connections: fixture.connections,
    originalConnections: fixture.originalSrj.connections,
    layerCount: fixture.originalSrj.layerCount,
    obstacles: fixture.originalSrj.obstacles,
    defaultViaHoleDiameter: via.holeDiameter,
    connMap,
  })
  const physical = evaluateRelaxedDrc({
    inputSrj: physicalReference,
    srjWithPointPairs: physicalReference,
    routedTraces: traces,
    drcOptions: { traceClearance: 0.089, viaToPadClearance: 0.089 },
  })
  expect(traces).toHaveLength(36)
  expect(physical.errors).toEqual([])
  expect(checkTracesAreContiguous(physical.circuitJson)).toEqual([])
  expect(
    traces.reduce(
      (count, trace) =>
        count +
        trace.route.filter((point) => point.route_type === "via").length,
      0,
    ),
  ).toBe(81)
  const seed =
    solver.initialBoundedRegionalRepairSolver!.getUnpublishedRepairSeed()
  if (seed === undefined)
    throw new Error("Missing actual private OrangeCrab seed")
  // Replay next-stage selection with real equal and reference-clean geometry.
  // Neither case may be replaced by the retained one-error candidate.
  for (const existingRoutes of [
    structuredClone(seed.routes),
    solver.getOutput(),
  ]) {
    const comparison = new Pipeline9JointDrcRepairSolver(params)
    Object.assign(comparison, {
      initialBoundedRepairSeed: seed,
      clearanceProjectionSolver: { getOutput: () => existingRoutes },
    })
    const exact = comparison.pipelineDef.find(
      (stage) => stage.solverName === "exactRepairSolver",
    )
    if (exact === undefined) throw new Error("Missing existing exact stage")
    exact.createSolver()
    expect(comparison.exactRepairSolver!.params.hdRoutes).toBe(existingRoutes)
    expect(
      comparison.stats.initialBoundedRegionalRepairSeedDrcIssueCount,
    ).toBeUndefined()
  }
  expect(JSON.stringify(fixture)).toBe(original)
  expect(JSON.stringify(physicalReference.traces)).toBe(fixedReference)
})
