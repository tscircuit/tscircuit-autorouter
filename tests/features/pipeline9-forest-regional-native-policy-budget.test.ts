import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
import { createPipeline9RegularNodeSolver, type Pipeline9RegularNodeSolverParams } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"
import { PriorityDagIntraNodeSolver } from "lib/solvers/HighDensitySolver/PriorityDagIntraNodeSolver"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver/GrowShrinkHighDensityIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("regional native policy retains existing search ceilings without adding ordinary routing's A13 family", (): void => {
  for (const layerCount of [2, 4]) {
    const node: NodeWithPortPoints = { capacityMeshNodeId: `policy-${layerCount}`, center: { x: 0, y: 0 },
      width: 4, height: 4, availableZ: Array.from({ length: layerCount }, (_, z) => z), portPoints: [
        { x: -2, y: -0.8, z: 0, connectionName: "signal-a", rootConnectionName: "signal-a" },
        { x: 2, y: -0.8, z: 0, connectionName: "signal-a", rootConnectionName: "signal-a" },
        { x: -2, y: 0.8, z: 0, connectionName: "signal-b", rootConnectionName: "signal-b" },
        { x: 2, y: 0.8, z: 0, connectionName: "signal-b", rootConnectionName: "signal-b" },
      ] }
    const params: Pipeline9RegularNodeSolverParams = { nodeWithPortPoints: node, connMap: new ConnectivityMap({ signalNetA: ["signal-a"], signalNetB: ["signal-b"] }),
      colorMap: {}, obstacles: [], layerCount, viaDiameter: 0.3, viaHoleDiameter: 0.15,
      minViaHoleEdgeToViaHoleEdgeClearance: 0.1, traceWidth: 0.1, obstacleMargin: 0.15,
      effort: 0.25, cacheProvider: null, nodePfById: new Map(), priorityDagSearch: true }
    const ordinary = createPipeline9RegularNodeSolver(params)
    const regional = new Pipeline9RegionalFallbackSolver({ ...params, useNativeRouting: true })
    const native = regional.highDensitySolver
    const originalRegional = new HighDensitySolver({ nodePortPoints: [node], useGrowShrinkHighDensityIntraNodeSolver: true,
      effort: params.effort, cacheProvider: null })
    expect(ordinary.enableNegotiatedSearch).toBe(true)
    expect(native.enableNegotiatedSearch).toBe(false)
    expect(originalRegional.enableNegotiatedSearch).toBe(false)
    expect(native.MAX_ITERATIONS).toBe(originalRegional.MAX_ITERATIONS)
    expect(native.MAX_ITERATIONS).toBe(10_000_000)
    expect(regional.MAX_ITERATIONS).toBe(25_000_000)
    expect(native.gridSearchSegmentWork).toBe(ordinary.gridSearchSegmentWork)
    expect(native.gridSearchSegmentWork).toBeLessThanOrEqual(originalRegional.gridSearchSegmentWork)
    expect(native.gridSearchWorkScale).toBe(layerCount > 2 ? 0.25 : 1)
    expect(native.gridSearchWorkScale).toBeLessThanOrEqual(originalRegional.gridSearchWorkScale)
    expect(native.growShrinkFallbackToInvalidGeometryOnFailure).toBe(false)
    expect(native.priorityDagOptions.priorityDagSearch).toBe(true)
    native.step()
    const growth = native.activeSubSolver as GrowShrinkHighDensityIntraNodeSolver
    expect(growth).toBeInstanceOf(GrowShrinkHighDensityIntraNodeSolver)
    expect(growth.maxGrowthAttempts).toBe(3)
    expect(growth.MAX_ITERATIONS).toBe(20_000_000)
    growth.step()
    const portfolio = growth.activeSubSolver ?? growth.winningSolver ?? growth.failedSolvers[0]!
    const candidates: Array<{ MAX_ITERATIONS: number; getSolverName(): string }> =
      portfolio.supervisedSolvers!.map(({ solver }) => solver)
    expect(candidates.some((solver) => solver.getSolverName().includes("A13"))).toBe(false)
    const grids = candidates.filter((solver) => solver instanceof HighDensitySolverA01)
    expect(grids.length).toBeGreaterThan(0)
    for (const grid of grids) expect(grid.MAX_ITERATIONS).toBeLessThanOrEqual(150_000 * native.gridSearchWorkScale)
    const priorities = candidates.filter((solver) => solver instanceof PriorityDagIntraNodeSolver)
    expect(priorities.length).toBeGreaterThan(0)
    for (const priority of priorities) {
      expect(priority.MAX_ITERATIONS + 1).toBe(priority.familySize * (Math.floor(priority.nativeCandidateIterationLimit) + 1))
    }
  }
})
