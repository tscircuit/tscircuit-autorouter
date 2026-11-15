import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import {
  checkEachPcbTraceNonOverlapping,
  checkViaPadClearance,
} from "@tscircuit/checks"
import type { AnyCircuitElement } from "circuit-json"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { preparePipeline9DrcRoutedTraces } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/preparePipeline9DrcRoutedTraces"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { combinePreloadedAndRoutedTraces } from "lib/utils/combinePreloadedAndRoutedTraces"
import { convertToCircuitJson } from "lib/utils/convertToCircuitJson"
import { getH616StagedClearancePcbSvg } from "tests/fixtures/getH616StagedClearancePcbSvg"

type StagedClearanceFixture = {
  originalSrj: SimpleRouteJson
  pairedObstacles: SimpleRouteJson["obstacles"]
  connections: SimpleRouteJson["connections"]
  newConnections: SimpleRouteJson["connections"]
  routes: HighDensityRoute[]
  inputRoutes: HighDensityRoute[]
  updatedPreloadedTraces: SimplifiedPcbTrace[]
  mutatedPreloadedTraceIds: string[]
  netMap: ConstructorParameters<typeof ConnectivityMap>[0]
  colorMap: Record<string, string>
  circuitJson: AnyCircuitElement[]
}

test("captures H616 ordinary signals beside previously routed DDR copper", async (): Promise<void> => {
  // Captured from the full-board Core run after routing DDR, before joint repair.
  const fixture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/assets/h616-staged-regional-clearance.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  ) as StagedClearanceFixture
  const original = structuredClone(fixture)
  const { originalSrj } = fixture
  const srj = {
    ...originalSrj,
    connections: fixture.connections,
    obstacles: fixture.pairedObstacles,
    traces: fixture.updatedPreloadedTraces,
  }
  const connMap = new ConnectivityMap(fixture.netMap)
  const solver = new Pipeline9JointDrcRepairSolver({
    srj,
    srjWithPointPairs: srj,
    originalSrj,
    newConnections: fixture.newConnections,
    newHdRoutes: fixture.routes,
    originalNewHdRoutes: fixture.inputRoutes,
    updatedPreloadedTraces: fixture.updatedPreloadedTraces,
    mutatedPreloadedTraceIds: new Set(fixture.mutatedPreloadedTraceIds),
    connMap,
    obstacles: srj.obstacles,
    layerCount: srj.layerCount,
    defaultViaDiameter: srj.minViaDiameter!,
    defaultViaHoleDiameter: srj.minViaHoleDiameter!,
    effort: 1,
    colorMap: fixture.colorMap,
  })
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(fixture).toEqual(original)
  const hdRoutes = solver.getOutput()
  for (const route of fixture.routes) {
    const output = hdRoutes.find(
      (candidate) => candidate.connectionName === route.connectionName,
    )!
    expect(output).toBeDefined()
    for (const point of [route.route[0]!, route.route.at(-1)!]) {
      expect(
        [output.route[0]!, output.route.at(-1)!].some(
          (endpoint) =>
            endpoint.x === point.x &&
            endpoint.y === point.y &&
            endpoint.z === point.z,
        ),
      ).toBeTrue()
    }
  }
  const preloadedTraces = solver.getUpdatedPreloadedTraces()
  expect(preloadedTraces.map((trace) => trace.pcb_trace_id)).toEqual(
    fixture.updatedPreloadedTraces.map((trace) => trace.pcb_trace_id),
  )
  for (const [index, trace] of fixture.updatedPreloadedTraces.entries()) {
    const output = preloadedTraces[index]!
    for (const point of [trace.route[0]!, trace.route.at(-1)!]) {
      if (point.route_type !== "wire") throw new Error("Expected terminal wire")
      expect(
        [output.route[0]!, output.route.at(-1)!].some(
          (endpoint) =>
            endpoint.route_type === "wire" &&
            endpoint.x === point.x &&
            endpoint.y === point.y &&
            endpoint.layer === point.layer,
        ),
      ).toBeTrue()
    }
  }
  const traces = preparePipeline9DrcRoutedTraces({
    originalPreloadedTraces: originalSrj.traces ?? [],
    mutatedPreloadedTraces: solver.getMutatedPreloadedTraces(),
    newTraces: convertPipeline7HdRoutesToSimplifiedPcbTraces({
      connections: fixture.newConnections,
      originalConnections: originalSrj.connections,
      hdRoutes,
      layerCount: srj.layerCount,
      obstacles: srj.obstacles,
      defaultViaHoleDiameter: srj.minViaHoleDiameter!,
      connMap,
    }),
  })
  const evaluate = createPipeline9AutoroutingDrcEvaluator({
    inputSrj: originalSrj,
    srjWithPointPairs: srj,
    includeBoardClearance: true,
  })
  expect(evaluate([]).errors).toEqual([])
  expect(evaluate(traces).errors).toHaveLength(5)
  const allTraces = combinePreloadedAndRoutedTraces(
    originalSrj.traces ?? [],
    traces,
  )
  const copper = convertToCircuitJson(srj, allTraces).flatMap(
    (element): AnyCircuitElement[] => {
      if (element.type === "pcb_trace") {
        const trace = allTraces.find(
          (trace) => trace.pcb_trace_id === element.pcb_trace_id,
        )!
        return [{ ...element, source_trace_id: trace.connection_name }]
      }
      return element.type === "pcb_via"
        ? [{ ...element, pcb_via_id: `routed_${element.pcb_via_id}` }]
        : []
    },
  )
  const circuitJson = [...fixture.circuitJson, ...copper]
  const errorCount = [
    ...checkEachPcbTraceNonOverlapping(circuitJson),
    ...checkViaPadClearance(circuitJson),
  ].length
  expect(errorCount).toBe(4)
  await expect(
    getH616StagedClearancePcbSvg({ circuitJson, errorCount }),
  ).toMatchSvgSnapshot(import.meta.path, { scale: 1 })
  await expect(
    getH616StagedClearancePcbSvg({ circuitJson, errorCount, focused: true }),
  ).toMatchSvgSnapshot(import.meta.path, { svgName: "ddr", scale: 1 })
})
