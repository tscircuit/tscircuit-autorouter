import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  createPipeline9RegularNodeSolver,
  Pipeline9HighDensitySolver,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { priorityParams } from "./priorityDagTestUtils"

test("priority policy activates in ordinary local Pipeline9 while the shared network factory stays native by default", () => {
  const params = priorityParams(),
    connMap = new ConnectivityMap({})
  const input = {
    nodeWithPortPoints: params.nodeWithPortPoints,
    connMap,
    colorMap: {},
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.1,
    effort: 1,
    nodePfById: {},
    obstacles: [],
    layerCount: 2,
  }
  const sharedDefault = createPipeline9RegularNodeSolver(input)
  expect(sharedDefault.priorityDagOptions.priorityDagSearch).toBe(false)
  const solver = new Pipeline9HighDensitySolver({
    nodePortPoints: [params.nodeWithPortPoints],
    connMap,
    fixedHdRoutes: [],
    colorMap: {},
    viaDiameter: 0.3,
    viaHoleDiameter: 0.15,
    minViaHoleEdgeToViaHoleEdgeClearance: 0.35,
    traceWidth: 0.1,
    obstacleMargin: 0.1,
    effort: 1,
    obstacles: [],
    layerCount: 2,
  })
  solver.step()
  expect(solver.activeRegularSolver?.priorityDagOptions.priorityDagSearch).toBe(
    true,
  )
  expect(solver.activeRegularSolver?.priorityDagOptions.viaHoleDiameter).toBe(
    0.15,
  )
  expect(
    solver.activeRegularSolver?.priorityDagOptions
      .minViaHoleEdgeToViaHoleEdgeClearance,
  ).toBe(0.35)
})
