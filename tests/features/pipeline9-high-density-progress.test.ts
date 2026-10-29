import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("Pipeline9 exposes active high-density work and progress between completed nodes", (): void => {
  const nodes: NodeWithPortPoints[] = [0, 4].map((x) => ({
    capacityMeshNodeId: `node-${x}`,
    center: { x, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0],
    portPoints: [
      { x: x - 1, y: 0, z: 0, connectionName: `signal-${x}` },
      { x: x + 1, y: 0, z: 0, connectionName: `signal-${x}` },
    ],
  }))
  const solver = new Pipeline9HighDensitySolver({
    nodePortPoints: nodes,
    fixedHdRoutes: [],
    connMap: new ConnectivityMap({}),
    obstacles: [],
    layerCount: 2,
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 0.1,
  })
  let sawActiveSolver = false
  let sawPartialProgress = false
  let previousProgress = 0
  while (!solver.solved && !solver.failed) {
    solver.step()
    sawActiveSolver ||=
      solver.activeSubSolver !== null && solver.activeSubSolver !== undefined
    sawPartialProgress ||= solver.progress > 0 && solver.progress < 1
    expect(solver.progress).toBeGreaterThanOrEqual(previousProgress)
    previousProgress = solver.progress
  }
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(sawActiveSolver).toBe(true)
  expect(sawPartialProgress).toBe(true)
  expect(solver.progress).toBe(1)
  expect(solver.routes).toHaveLength(2)
  expect(solver.activeSubSolver).toBeNull()
})
