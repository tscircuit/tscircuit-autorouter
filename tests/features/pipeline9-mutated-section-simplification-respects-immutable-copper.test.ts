import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { preparePipeline9MutatedPreloadedSections } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-mutated-preloaded-trace-simplification"
import { TraceSimplificationSolver } from "lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import {
  createHighlightedMutationFixture,
  highlightedFirstVia,
  highlightedSecondVia,
} from "../fixtures/pipeline9-mutated-section-simplification"

test("Pipeline9 retains mutation-region vias when immutable copper blocks simplification", () => {
  const fixture = createHighlightedMutationFixture()
  const prepared = preparePipeline9MutatedPreloadedSections({
    ...fixture,
  })
  const blockingRoute: HighDensityRoute = {
    connectionName: "blocking_trace",
    rootConnectionName: "blocking_net",
    traceThickness: 0.15,
    viaDiameter: 0.5,
    route: [
      { x: 8.7, y: -5, z: 0 },
      { x: 8.7, y: -3, z: 0 },
    ],
    vias: [],
  }
  const blockingRouteSnapshot = structuredClone(blockingRoute)

  const solver = new TraceSimplificationSolver({
    hdRoutes: prepared.sections.map((section) => section.hdRoute),
    otherHdRoutes: [...prepared.immutableHdRoutes, blockingRoute],
    obstacles: [],
    connMap: new ConnectivityMap({}),
    colorMap: {},
    outline: [
      { x: 8.25, y: -5 },
      { x: 9.05, y: -5 },
      { x: 9.05, y: -3 },
      { x: 8.25, y: -3 },
    ],
    defaultViaDiameter: 0.5,
    layerCount: 2,
    netByConnectionName: new Map([
      [prepared.sections[0]!.connectionName, "source_trace_10"],
      [blockingRoute.connectionName, "blocking_net"],
    ]),
    enableCrossingViaReduction: true,
  })
  solver.solve()

  expect(solver.failed).toBeFalse()
  expect(solver.simplifiedHdRoutes).toHaveLength(1)
  expect(solver.simplifiedHdRoutes[0]!.vias).toEqual([
    highlightedFirstVia,
    highlightedSecondVia,
  ])
  expect(blockingRoute).toEqual(blockingRouteSnapshot)
})
