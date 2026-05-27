import { expect, test } from "bun:test"
import * as dataset01 from "@tscircuit/autorouting-dataset-01"
import { getGlobalInMemoryCache } from "lib/cache/setupGlobalCaches"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types"

const getCircuit102 = () =>
  (dataset01 as Record<string, unknown>).circuit102 as SimpleRouteJson

const getNodeOrThrow = (
  nodes: NodeWithPortPoints[] | undefined,
  nodeId: string,
) => {
  const node = nodes?.find(
    (candidate) => candidate.capacityMeshNodeId === nodeId,
  )
  expect(node).toBeDefined()
  return node!
}

const getUniquePortPointSignature = (node: NodeWithPortPoints) => {
  const uniquePortPoints = [
    ...new Map(
      node.portPoints.map((point) => [point.portPointId, point] as const),
    ).values(),
  ]

  return {
    count: uniquePortPoints.length,
    connectionNames: uniquePortPoints.map((point) => point.connectionName),
    portPointIds: uniquePortPoints.map((point) => point.portPointId),
  }
}

test(
  "pipeline4 dataset01 circuit102 tracks cmn_159 reduction shape across node-cap and effort settings",
  () => {
    getGlobalInMemoryCache().clearCache()

    const defaultSolver = new AutoroutingPipelineSolver4(
      structuredClone(getCircuit102()),
    )
    defaultSolver.solve()

    expect(defaultSolver.solved).toBe(true)
    expect(defaultSolver.failed).toBe(false)
    expect(defaultSolver.error).toBeNull()

    const defaultMetadata =
      defaultSolver.highDensityRouteSolver?.nodeSolveMetadataById.get("cmn_159")
    const defaultNode = getNodeOrThrow(
      defaultSolver.highDensityNodePortPoints,
      "cmn_159",
    )
    const defaultSignature = getUniquePortPointSignature(defaultNode)

    expect(defaultMetadata?.status).toBe("solved")
    expect(defaultMetadata?.solverType).toBe(
      "SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost",
    )
    expect(defaultMetadata?.routeCount).toBe(1)
    expect(defaultSignature.count).toBe(2)
    expect(new Set(defaultSignature.connectionNames).size).toBe(1)
    expect(defaultSignature.connectionNames).toEqual([
      "source_net_2_mst1",
      "source_net_2_mst1",
    ])

    getGlobalInMemoryCache().clearCache()

    const explicit8mmSolver = new AutoroutingPipelineSolver4(
      structuredClone(getCircuit102()),
      { maxNodeDimension: 8 },
    )
    explicit8mmSolver.solve()

    expect(explicit8mmSolver.solved).toBe(true)
    expect(explicit8mmSolver.failed).toBe(false)

    const explicit8mmMetadata =
      explicit8mmSolver.highDensityRouteSolver?.nodeSolveMetadataById.get(
        "cmn_159",
      )
    const explicit8mmNode = getNodeOrThrow(
      explicit8mmSolver.highDensityNodePortPoints,
      "cmn_159",
    )
    const explicit8mmSignature = getUniquePortPointSignature(explicit8mmNode)

    expect(explicit8mmMetadata?.status).toBe("solved")
    expect(explicit8mmMetadata?.solverType).toBe("HighDensitySolverA03")
    expect(explicit8mmMetadata?.routeCount).toBe(2)
    expect(explicit8mmSignature.count).toBe(4)
    expect(new Set(explicit8mmSignature.connectionNames).size).toBe(2)
    expect(explicit8mmSignature.connectionNames).toEqual([
      "source_net_3_mst1",
      "source_net_3_mst1",
      "source_net_2_mst1",
      "source_net_2_mst1",
    ])

    getGlobalInMemoryCache().clearCache()

    const effort2Solver = new AutoroutingPipelineSolver4(
      structuredClone(getCircuit102()),
      { effort: 2 },
    )
    effort2Solver.solve()

    expect(effort2Solver.solved).toBe(true)
    expect(effort2Solver.failed).toBe(false)

    const effort2Metadata =
      effort2Solver.highDensityRouteSolver?.nodeSolveMetadataById.get("cmn_159")
    const effort2Node = getNodeOrThrow(
      effort2Solver.highDensityNodePortPoints,
      "cmn_159",
    )
    const effort2Signature = getUniquePortPointSignature(effort2Node)

    expect(effort2Metadata?.status).toBe("solved")
    expect(effort2Metadata?.solverType).toBe("HighDensitySolverA01")
    expect(effort2Metadata?.routeCount).toBe(2)
    expect(effort2Signature.count).toBe(4)
    expect(new Set(effort2Signature.connectionNames).size).toBe(2)
    expect(effort2Signature.connectionNames).toEqual([
      "source_net_15_mst0",
      "source_net_15_mst0",
      "source_net_6_mst2",
      "source_net_6_mst2",
    ])
  },
  { timeout: 120_000 },
)
