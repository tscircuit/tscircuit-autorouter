import { expect, test } from "bun:test"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convert-preloaded-traces-to-hd-routes"
import { createRegionalFallbackProblemForRouteSegmentInterval } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-regional-fallback"

test("Pipeline9 explicit regional intervals own every route reentry between boundary anchors", () => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "explicit_interval",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0],
    portPoints: [],
    portPointsInPairs: [],
  }
  const route: PreloadedHighDensityRoute = {
    connectionName: "owner",
    rootConnectionName: "owner",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -3, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 3, y: 0, z: 0 },
      { x: 3, y: 3, z: 0 },
      { x: 0, y: 3, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 3, y: 0, z: 0 },
    ],
    vias: [],
    preloadedTraceIndex: 0,
    preloadedRouteIndex: 0,
    isThroughObstacle: false,
  }

  expect(
    createRegionalFallbackProblemForRouteSegmentInterval({
      node,
      sourceRoute: route,
      interval: { startSegmentIndex: 4, endSegmentIndex: 5 },
    }),
  ).toBeUndefined()
  expect(
    createRegionalFallbackProblemForRouteSegmentInterval({
      node,
      sourceRoute: route,
      interval: { startSegmentIndex: 1, endSegmentIndex: 4 },
    }),
  ).toBeUndefined()
  expect(
    createRegionalFallbackProblemForRouteSegmentInterval({
      node,
      sourceRoute: route,
      interval: { startSegmentIndex: 5, endSegmentIndex: 0 },
    }),
  ).toBeUndefined()

  const ownedProblem = createRegionalFallbackProblemForRouteSegmentInterval({
    node,
    sourceRoute: route,
    interval: { startSegmentIndex: 0, endSegmentIndex: 5 },
  })
  expect(ownedProblem).toBeDefined()
  expect(ownedProblem?.nodeWithPortPoints.portPoints).toEqual([
    expect.objectContaining({ x: -1, y: 0, z: 0 }),
    expect.objectContaining({ x: 1, y: 0, z: 0 }),
  ])
  expect(ownedProblem?.fixedRouteSectionsByConnectionName.get("owner")).toEqual(
    expect.objectContaining({
      start: expect.objectContaining({ segmentIndex: 0 }),
      end: expect.objectContaining({ segmentIndex: 5 }),
    }),
  )
})
