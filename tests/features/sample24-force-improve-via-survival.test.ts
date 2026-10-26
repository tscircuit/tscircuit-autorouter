import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { hasViaObstacleCollision } from "lib/solvers/HyperHighDensitySolver/hasViaObstacleCollision"
import type { HighDensityRoute, NodeWithPortPoints } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types/srj-types"
import fixture from "../fixtures/sample24-constructive-transition-c74.json"

test("source P9 HD, force improvement and repair preserve the legal external C74 via", (): void => {
  const node = structuredClone(fixture.node) as NodeWithPortPoints
  const input = {
    layerCount: 8, allowBlindAndBuriedVias: false, minTraceWidth: 0.1,
    minViaDiameter: 0.3, minViaHoleDiameter: 0.15,
    bounds: fixture.boardGeometry.bounds, outline: fixture.boardGeometry.outline,
    obstacles: structuredClone(fixture.obstacles), connections: [],
  } as unknown as SimpleRouteJson
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, { effort: 1 })
  pipeline.portPointPathingSolver = {
    getOutput: () => ({ nodesWithPortPoints: [node], changedPreloadedTraceSections: [] }),
    computeNodePfMap: () => new Map([[node.capacityMeshNodeId, null]]),
  } as any
  pipeline.uniformPortDistributionSolver = { getOutput: () => [node] } as any
  const originalInput = JSON.stringify(input)
  let hdOutput: HighDensityRoute[] | undefined
  for (const name of ["highDensityRouteSolver", "highDensityForceImproveSolver", "highDensityRepairSolver"] as const) {
    const definition = pipeline.pipelineDef.find((entry) => entry.solverName === name)!
    const params = definition.getConstructorParams(pipeline)
    const solver = new definition.solverClass(...params as any)
    ;(pipeline as any)[name] = solver
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    const routes: HighDensityRoute[] = name === "highDensityRouteSolver" ? (solver as any).routes : (solver as any).getOutput()
    if (!hdOutput) hdOutput = structuredClone(routes)
    expect(routes).toEqual(hdOutput)
    expect(hasViaObstacleCollision({ routes, obstacles: pipeline.srj.obstacles,
      connMap: pipeline.connMap, layerCount: 8, allowBlindAndBuriedVias: false,
      viaDiameter: 0.3, viaToPadClearance: 0.15, center: node.center, coordinateScale: 1 })).toBe(false)
    if (name === "highDensityForceImproveSolver") {
      expect((solver as any).totalStepsPerNode).toBe(20)
      expect(solver.iterations).toBe(1)
      expect(solver.stats.viaObstacleRejectedSampleCount).toBe(1)
      expect(solver.stats.improvedNodeCount).toBe(0)
      expect(solver.stats.improvedRouteCount).toBe(0)
      const captured = (solver as any).getConstructorParams()[0]
      expect(JSON.parse(JSON.stringify(captured.viaObstacleContext))).toEqual(captured.viaObstacleContext)
      expect(captured.viaObstacleContext.viaToPadClearance).toBe(0.15)
      expect(Object.values(captured.viaObstacleContext).some((value) => typeof value === "function")).toBe(false)
    }
  }
  expect(hdOutput![0]!.vias[0]!.x).toBeGreaterThan(node.center.x + node.width / 2)
  expect(hdOutput![0]!.route[0]).toEqual({ x: node.portPoints[0]!.x, y: node.portPoints[0]!.y, z: 4 })
  expect(hdOutput![0]!.route.at(-1)).toEqual({ x: node.portPoints[1]!.x, y: node.portPoints[1]!.y, z: 0 })
  expect(JSON.stringify(input)).toBe(originalInput)
  expect(node).toEqual(fixture.node)
})
