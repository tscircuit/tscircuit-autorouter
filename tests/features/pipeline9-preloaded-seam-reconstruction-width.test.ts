import { expect, test } from "bun:test"
import { applyFixedRouteReplacementsToPreloadedTraces } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyFixedRouteReplacementsToPreloadedTraces"
import { convertPreloadedTraceToHdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import { getMaterializedPreloadedSectionHdRoutes, removeChangedSectionsFromFixedHdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/materializeHypergraphPreloadedTraceSections"
import { pinPipeline9PreloadedSectionEndpoints } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pinPipeline9PreloadedSectionEndpoints"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createPreloadedSeamFixture } from "../fixtures/pipeline9-preloaded-seam-fixture"

test("reconstructing a preload with a wider remote section retains the exact owned seam span width", (): void => {
  const input = createPreloadedSeamFixture(true)
  const original = input.sourceSrj.traces![0]!
  original.route.push(
    { route_type: "wire", x: 3, y: 2, layer: "top", width: 0.2 },
    { route_type: "wire", x: 4, y: 2, layer: "top", width: 0.2 },
  )
  const section = input.sections[0]!
  section.connection.pointsToConnect.reverse()
  const start = section.startRoutePosition
  section.startRoutePosition = section.endRoutePosition
  section.endRoutePosition = start
  for (const witness of input.witnesses) witness.endpointIndex = witness.endpointIndex === 0 ? 1 : 0
  const pins = pinPipeline9PreloadedSectionEndpoints(input)
  const stitch = new MultipleHighDensityRouteStitchSolver3({
    connections: [section.connection], layerCount: 2, useDeclaredConnectionEndpoints: true,
    hdRoutes: [...pins.ownedConnectors, {
      connectionName: section.connectionName, rootConnectionName: input.witnesses[0]!.rootConnectionName,
      traceThickness: 0.1, viaDiameter: 0.3,
      route: [{ x: -1, y: -1, z: 0 }, { x: 0, y: 0, z: 0 }], vias: [],
    }],
  })
  stitch.solve()
  expect(stitch.failed).toBeFalse()
  expect(stitch.solved).toBeTrue()
  const connMap = getConnectivityMapFromSimpleRouteJson(input.sourceSrj)
  const fixed = convertPreloadedTraceToHdRoutes(original, 0, 2, 0.3, connMap)
  const remaining = removeChangedSectionsFromFixedHdRoutes({ traces: [original], sections: input.sections, fixedHdRoutes: fixed })
  const materialized = getMaterializedPreloadedSectionHdRoutes({ traces: [original], sections: input.sections, stitchedHdRoutes: stitch.mergedHdRoutes, layerCount: 2 })
  const rebuilt = applyFixedRouteReplacementsToPreloadedTraces({
    originalTraces: [original], originalFixedRoutes: fixed,
    updatedFixedRoutes: [...remaining, ...materialized],
    replacedConnectionNames: new Set(fixed.map((route) => route.connectionName)),
    unchangedFixedRouteConnectionNames: new Set(remaining.map((route) => route.connectionName)),
    layerCount: 2, defaultViaHoleDiameter: 0.15, obstacles: [], connMap,
  }).updatedPreloadedTraces[0]!
  expect(rebuilt.route.find((point) => point.route_type === "wire" && point.x === 0 && point.y === 0)).toMatchObject({ width: 0.1 })
  expect(rebuilt.route.some((point) => point.route_type === "wire" && point.width === 0.2)).toBeTrue()
  expect(rebuilt.pcb_trace_id).toBe(original.pcb_trace_id)
  expect(rebuilt.route[0]).toEqual(original.route[0])
  expect(rebuilt.route.at(-1)).toEqual(original.route.at(-1))
})
