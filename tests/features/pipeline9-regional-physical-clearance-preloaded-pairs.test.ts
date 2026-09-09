import { expect, test } from "bun:test"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import { createRegionalFallbackProblem } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9RegionalFallback"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { createPipeline9RegionalPhysicalProblem } from "../fixtures/pipeline9RegionalPhysicalClearance"

test("ordinary preloaded regional pairs keep source aliases and exact clipped obligations under physical context", (): void => {
  const fixture = createPipeline9RegionalPhysicalProblem()
  const preload: PreloadedHighDensityRoute = {
    connectionName: "local-preload-section",
    rootConnectionName: "preload-root",
    traceThickness: 0.125,
    viaDiameter: 0.25,
    preloadedTraceIndex: 0,
    preloadedRouteIndex: 0,
    preloadedRoutePositionStart: 0,
    preloadedRoutePositionEnd: 1,
    route: [
      { x: 0, y: -3.25, z: 0, traceThickness: 0.125 },
      { x: 6, y: -3.25, z: 0, traceThickness: 0.125 },
    ],
    vias: [],
  }
  const originalPreload = structuredClone(preload)
  const originalNode = structuredClone(fixture.node)
  const problem = createRegionalFallbackProblem(fixture.node, [preload])
  expect(problem.nodeWithPortPoints.portPointsInPairs).toHaveLength(2)
  const solver = new Pipeline9RegionalFallbackSolver({
    ...fixture.params,
    nodeWithPortPoints: problem.nodeWithPortPoints,
    movablePreloadedConnectionNames: new Set([preload.connectionName]),
  })
  const context = solver.highDensitySolver.physicalClearanceContext
  if (!context) throw new Error("Expected complete regional physical context")
  const preloadNet = fixture.connMap.getNetConnectedToId("preload-source")
  if (preloadNet === undefined) throw new Error("Expected recorded preload net")
  expect(
    context.canonicalNetIdByConnectionName.get(preload.connectionName),
  ).toBe(preloadNet)
  expect(context.canonicalNetIdByConnectionName.get("local-target")).toBe(
    fixture.canonicalTargetNetId,
  )
  const intra = new IntraNodeRouteSolver({
    ...fixture.params,
    nodeWithPortPoints: problem.nodeWithPortPoints,
    physicalClearanceContext: context,
  })
  expect(intra.unsolvedConnections).toHaveLength(2)
  expect(intra.unsolvedConnections).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        connectionName: "local-preload-section",
        rootConnectionName: "preload-root",
        points: [
          expect.objectContaining({ x: 1, y: -3.25, z: 0 }),
          expect.objectContaining({ x: 5, y: -3.25, z: 0 }),
        ],
      }),
      expect.objectContaining({
        connectionName: "local-target",
        points: [
          expect.objectContaining({ x: 1, y: -2, z: 0 }),
          expect.objectContaining({ x: 5, y: -2, z: 0 }),
        ],
      }),
    ]),
  )
  expect(
    problem.fixedRouteSectionsByConnectionName.get(preload.connectionName)
      ?.sourceRoutes[0],
  ).toBe(preload)
  expect(preload).toEqual(originalPreload)
  expect(fixture.node).toEqual(originalNode)
  expect(solver.forceImproveSolver).toBeUndefined()
})
