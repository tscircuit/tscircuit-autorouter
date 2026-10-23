import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { GrowShrinkHighDensityIntraNodeSolver } from "../../lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver/GrowShrinkHighDensityIntraNodeSolver"
import type { NodeWithPortPoints } from "../../lib/types/high-density-types"
import crowdedNode from "../fixtures/am3352-crowded-node.json"

test("generic detailed invariants and raw iteration exhaustion do not become learned conflicts", (): void => {
  const node = {
    capacityMeshNodeId: "node", center: { x: 0, y: 0 }, width: 4, height: 4, availableZ: [0, 1],
    portPoints: [
      { connectionName: "a", x: -2, y: 0, z: 0 },
      { connectionName: "a", x: 2, y: 0, z: 0 },
    ],
  }
  const solver = new Pipeline9HighDensitySolver({
    nodePortPoints: [node], fixedHdRoutes: [], connMap: new ConnectivityMap({}), obstacles: [],
    layerCount: 2, viaDiameter: 0.3, traceWidth: 0.1, obstacleMargin: 0.15, effort: 1,
    collectDetailedRoutingFeedback: true,
  })
  solver.step()
  expect(solver.activeRegularSolver).not.toBeNull()
  solver.activeRegularSolver!.step = (): void => { throw new Error("forced malformed geometry invariant") }
  expect(() => solver.step()).toThrow("forced malformed geometry invariant")
  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(solver.detailedRoutingConflicts).toEqual([])
  const bounded = new GrowShrinkHighDensityIntraNodeSolver({ nodeWithPortPoints: crowdedNode as NodeWithPortPoints, effort: 1 })
  bounded.MAX_ITERATIONS = 0
  bounded.step()
  expect(bounded.failed).toBe(true)
  expect(bounded.solved).toBe(false)
  expect(bounded.error).toContain("ran out of iterations")
  expect(bounded.detailedRoutingFailureKind).toBeUndefined()
})
