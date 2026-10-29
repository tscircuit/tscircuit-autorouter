import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import { getGlobalInMemoryCache } from "lib/cache/setupGlobalCaches"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"
import nodeJson from "../fixtures/srj18-sample15-sub-via-node.json"

const subViaNode: NodeWithPortPoints = nodeJson
const crossingPorts = [
  { x: -1, y: 0, z: 0, connectionName: "horizontal" },
  { x: 1, y: 0, z: 0, connectionName: "horizontal" },
  { x: 0, y: -1, z: 0, connectionName: "vertical" },
  { x: 0, y: 1, z: 0, connectionName: "vertical" },
]
const impossibleNode: NodeWithPortPoints = {
  capacityMeshNodeId: "impossible-single-layer-node",
  center: { x: 0, y: 0 },
  width: 2,
  height: 2,
  availableZ: [0],
  portPoints: crossingPorts,
  portPointsInPairs: [
    [crossingPorts[0]!, crossingPorts[1]!],
    [crossingPorts[2]!, crossingPorts[3]!],
  ],
}

test("regional debug capture preserves default history and routing while Pipeline9 opts out", async (): Promise<void> => {
  for (const [node, layerCount, succeeds] of [
    [subViaNode, 4, true],
    [impossibleNode, 1, false],
  ] as const) {
    const observations = [undefined, true, false].map((captureSearchDebug) => {
      getGlobalInMemoryCache().clearCache()
      const inputNode = structuredClone(node)
      const originalNode = structuredClone(inputNode)
      const solver = new Pipeline9RegionalFallbackSolver({
        nodeWithPortPoints: inputNode,
        colorMap: {},
        connMap: new ConnectivityMap({}),
        viaDiameter: 0.3,
        traceWidth: 0.1,
        obstacleMargin: 0.15,
        effort: 1,
        obstacles: [],
        layerCount,
        captureSearchDebug,
      })
      expect(solver.highDensitySolver.captureSearchDebug).toBe(
        captureSearchDebug ?? true,
      )
      solver.highDensitySolver.step()
      const growth = solver.highDensitySolver.activeSubSolver
      expect(growth).toBeInstanceOf(GrowShrinkHighDensityIntraNodeSolver)
      solver.solve()
      expect(inputNode).toEqual(originalNode)
      return {
        solver,
        growth: growth as GrowShrinkHighDensityIntraNodeSolver,
      }
    })
    const [defaultCapture, enabled, disabled] = observations
    expect(disabled!.growth.failedSolvers).toHaveLength(0)
    expect(enabled!.growth.failedSolvers.length).toBe(
      defaultCapture!.growth.failedSolvers.length,
    )
    for (const { solver, growth } of observations) {
      expect(solver.solved).toBe(succeeds)
      expect(solver.failed).toBe(!succeeds)
      expect(solver.getOutput()).toEqual(defaultCapture!.solver.getOutput())
      expect(solver.error).toBe(defaultCapture!.solver.error)
      expect(solver.iterations).toBe(defaultCapture!.solver.iterations)
      expect(solver.stats).toEqual(defaultCapture!.solver.stats)
      expect(solver.highDensitySolver.stats).toEqual(
        defaultCapture!.solver.highDensitySolver.stats,
      )
      expect(growth.iterations).toBe(defaultCapture!.growth.iterations)
      expect(growth.growthAttempts).toBe(defaultCapture!.growth.growthAttempts)
      expect(growth.scaleFactor).toBe(defaultCapture!.growth.scaleFactor)
      expect(growth.error).toBe(defaultCapture!.growth.error)
    }
    if (succeeds) {
      expect(defaultCapture!.growth.failedSolvers.length).toBeGreaterThan(0)
      expect(disabled!.solver.getOutput()).toHaveLength(3)
      expect(disabled!.solver.forceImproveSolver?.solved).toBeTrue()
      expect(disabled!.solver.repairSolver?.solved).toBeTrue()
    } else {
      expect(disabled!.solver.getOutput()).toEqual([])
      expect(disabled!.solver.error).toContain("impossible single-layer crossing")
    }
  }

  const { scenario } = await loadScenarioBySampleNumber("srj18", 1)
  const pipelines = [true, false].map((legacyCapture) => {
    getGlobalInMemoryCache().clearCache()
    const input = structuredClone(scenario)
    const originalInput = structuredClone(input)
    const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
      cacheProvider: null,
      effort: 1,
    })
    while (
      !pipeline.highDensityRouteSolver?.activeFallbackSolver &&
      !pipeline.failed &&
      !pipeline.solved
    ) {
      pipeline.step()
    }
    const regional = pipeline.highDensityRouteSolver?.activeFallbackSolver
    expect(regional).toBeDefined()
    expect(regional!.highDensitySolver.captureSearchDebug).toBeFalse()
    // Reproduce the former fallback behavior before its first routing step.
    if (legacyCapture) regional!.highDensitySolver.captureSearchDebug = true
    pipeline.solveUntilPhase("highDensityStitchSolver")
    expect(pipeline.failed).toBeFalse()
    expect(pipeline.highDensityRouteSolver?.solved).toBeTrue()
    expect(pipeline.highDensityRouteSolver?.stats.fallbackNodeCount).toBe(1)
    expect(input).toEqual(originalInput)
    return pipeline
  })
  expect(pipelines[1]!.highDensityRouteSolver?.routes).toEqual(
    pipelines[0]!.highDensityRouteSolver?.routes,
  )
  expect(pipelines[1]!.highDensityRouteSolver?.stats).toEqual(
    pipelines[0]!.highDensityRouteSolver?.stats,
  )
  expect(pipelines[1]!.iterations).toBe(pipelines[0]!.iterations)
  expect(pipelines[1]!.error).toBe(pipelines[0]!.error)
  getGlobalInMemoryCache().clearCache()
})
