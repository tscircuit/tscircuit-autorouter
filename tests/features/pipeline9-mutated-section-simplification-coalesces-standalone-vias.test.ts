import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convert-preloaded-traces-to-hd-routes"
import {
  applyPipeline9MutatedPreloadedSections,
  preparePipeline9MutatedPreloadedSections,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-mutated-preloaded-trace-simplification"
import { TraceSimplificationSolver } from "lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"

test("Pipeline9 coalesces standalone vias inside one mutated region", () => {
  const createRoute = (
    connectionName: string,
    preloadedRouteIndex: number,
    route: PreloadedHighDensityRoute["route"],
  ): PreloadedHighDensityRoute => ({
    connectionName,
    rootConnectionName: "net0",
    preloadedTraceIndex: 0,
    preloadedRouteIndex,
    preloadedRoutePositionStart: preloadedRouteIndex,
    preloadedRoutePositionEnd: preloadedRouteIndex + 1,
    traceThickness: 0.15,
    viaDiameter: 0.5,
    route,
    vias:
      route[0]!.z === route[1]!.z ? [] : [{ x: route[1]!.x, y: route[1]!.y }],
  })
  const updatedFixedRoutes = [
    createRoute("wire_before", 0, [
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
    ]),
    createRoute("first_via", 1, [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
    ]),
    createRoute("wire_between", 2, [
      { x: 0, y: 0, z: 1 },
      { x: 0.1, y: 0, z: 1 },
    ]),
    createRoute("second_via", 3, [
      { x: 0.1, y: 0, z: 1 },
      { x: 0.1, y: 0, z: 0 },
    ]),
    createRoute("wire_after", 4, [
      { x: 0.1, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ]),
  ]
  const prepared = preparePipeline9MutatedPreloadedSections({
    updatedFixedRoutes,
    regionalMutationMasks: new Map(
      updatedFixedRoutes.map((route) => [route.connectionName, [true]]),
    ),
  })

  expect(prepared.sections).toHaveLength(1)
  expect(
    prepared.sections[0]!.section.sourceRoutes.map(
      (route) => route.connectionName,
    ),
  ).toEqual(updatedFixedRoutes.map((route) => route.connectionName))
  expect(prepared.sections[0]!.hdRoute.vias).toEqual([
    { x: 0, y: 0 },
    { x: 0.1, y: 0 },
  ])

  const editableRoute = prepared.sections[0]!.hdRoute
  const solver = new TraceSimplificationSolver({
    hdRoutes: [editableRoute],
    otherHdRoutes: prepared.immutableHdRoutes,
    obstacles: [],
    connMap: new ConnectivityMap({ net0: [editableRoute.connectionName] }),
    colorMap: {},
    defaultViaDiameter: 0.5,
    layerCount: 2,
    netByConnectionName: new Map([[editableRoute.connectionName, "net0"]]),
    enableCrossingViaReduction: true,
    preserveRouteEndpoints: true,
  })
  solver.solve()

  expect(solver.failed).toBeFalse()
  expect(solver.simplifiedHdRoutes[0]!.vias).toEqual([])
  const applied = applyPipeline9MutatedPreloadedSections({
    updatedFixedRoutes: prepared.normalizedFixedRoutes,
    sections: prepared.sections,
    simplifiedHdRoutes: solver.simplifiedHdRoutes,
  })
  expect(applied).toHaveLength(1)
  expect(applied[0]!.vias).toEqual([])
})
