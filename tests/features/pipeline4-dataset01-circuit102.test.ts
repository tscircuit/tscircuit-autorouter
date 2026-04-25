import { expect, test } from "bun:test"
import * as dataset01 from "@tscircuit/autorouting-dataset-01"
import { getGlobalInMemoryCache } from "lib/cache/setupGlobalCaches"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types"

const getCircuit102 = () =>
  (dataset01 as Record<string, unknown>).circuit102 as SimpleRouteJson

const getConvexBridgeNodeOrThrow = (
  nodes: NodeWithPortPoints[] | undefined,
) => {
  const node = nodes?.find(
    (candidate) =>
      candidate.portPoints.some(
        (point) => point.connectionName === "source_net_10_mst0",
      ) &&
      candidate.portPoints.some(
        (point) => point.connectionName === "source_net_2_mst1",
      ) &&
      candidate.portPoints.some(
        (point) => point.connectionName === "source_net_15_mst0",
      ),
  )
  expect(node).toBeDefined()
  return node!
}

test(
  "pipeline4 dataset01 circuit102 solves the convex bridge node consistently across settings",
  () => {
    getGlobalInMemoryCache().clearCache()

    const defaultSolver = new AutoroutingPipelineSolver4(
      structuredClone(getCircuit102()),
    )
    defaultSolver.solve()

    expect(defaultSolver.solved).toBe(true)
    expect(defaultSolver.failed).toBe(false)
    expect(defaultSolver.error).toBeNull()

    const defaultNode = getConvexBridgeNodeOrThrow(
      defaultSolver.highDensityNodePortPoints,
    )
    const defaultMetadata =
      defaultSolver.highDensityRouteSolver?.nodeSolveMetadataById.get(
        defaultNode.capacityMeshNodeId,
      )

    expect(defaultMetadata?.status).toBe("solved")
    expect(defaultMetadata?.solverType).toBe("DirectPairHeuristic")
    expect(defaultNode.availableZ).toEqual([0, 1])
    expect(defaultNode.portPoints.length).toBe(12)
    expect(
      new Set(defaultNode.portPoints.map((point) => point.connectionName)).size,
    ).toBe(6)

    getGlobalInMemoryCache().clearCache()

    const explicit8mmSolver = new AutoroutingPipelineSolver4(
      structuredClone(getCircuit102()),
      { maxNodeDimension: 8 },
    )
    explicit8mmSolver.solve()

    expect(explicit8mmSolver.solved).toBe(true)
    expect(explicit8mmSolver.failed).toBe(false)

    const explicit8mmNode = getConvexBridgeNodeOrThrow(
      explicit8mmSolver.highDensityNodePortPoints,
    )
    const explicit8mmMetadata =
      explicit8mmSolver.highDensityRouteSolver?.nodeSolveMetadataById.get(
        explicit8mmNode.capacityMeshNodeId,
      )

    expect(explicit8mmMetadata?.status).toBe("solved")
    expect(explicit8mmMetadata?.solverType).toBe("DirectPairHeuristic")
    expect(explicit8mmNode.capacityMeshNodeId).toBe(
      defaultNode.capacityMeshNodeId,
    )
    expect(explicit8mmNode.availableZ).toEqual([0, 1])
    expect(explicit8mmNode.portPoints.length).toBe(
      defaultNode.portPoints.length,
    )

    getGlobalInMemoryCache().clearCache()

    const effort2Solver = new AutoroutingPipelineSolver4(
      structuredClone(getCircuit102()),
      { effort: 2 },
    )
    effort2Solver.solve()

    expect(effort2Solver.solved).toBe(true)
    expect(effort2Solver.failed).toBe(false)

    const effort2Node = getConvexBridgeNodeOrThrow(
      effort2Solver.highDensityNodePortPoints,
    )
    const effort2Metadata =
      effort2Solver.highDensityRouteSolver?.nodeSolveMetadataById.get(
        effort2Node.capacityMeshNodeId,
      )

    expect(effort2Metadata?.status).toBe("solved")
    expect(effort2Metadata?.solverType).toBe("DirectPairHeuristic")
    expect(effort2Node.capacityMeshNodeId).toBe(defaultNode.capacityMeshNodeId)
    expect(effort2Node.portPoints.length).toBe(defaultNode.portPoints.length)
    expect(effort2Node.availableZ).toEqual([0, 1])
  },
  { timeout: 120_000 },
)
