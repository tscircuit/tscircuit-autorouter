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

test(
  "pipeline4 dataset01 circuit102 changes cmn_159 reduction shape across node-cap and effort settings",
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

    expect(defaultMetadata?.status).toBe("solved")
    expect(defaultNode.portPoints.length).toBe(4)
    expect(
      new Set(defaultNode.portPoints.map((point) => point.connectionName)).size,
    ).toBe(2)

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

    expect(explicit8mmMetadata?.status).toBe("solved")
    expect(explicit8mmMetadata?.solverType).toBe(
      "SingleLayerNoDifferentRootIntersectionsIntraNodeSolver",
    )
    expect(explicit8mmNode.portPoints.length).toBeGreaterThan(
      defaultNode.portPoints.length,
    )
    expect(
      new Set(explicit8mmNode.portPoints.map((point) => point.connectionName))
        .size,
    ).toBeGreaterThanOrEqual(2)
    expect(
      JSON.stringify(
        explicit8mmNode.portPoints.map((point) => point.connectionName),
      ),
    ).not.toBe(
      JSON.stringify(
        defaultNode.portPoints.map((point) => point.connectionName),
      ),
    )

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

    expect(effort2Metadata?.status).toBe("solved")
    expect(effort2Node.portPoints.length).toBeLessThan(
      defaultNode.portPoints.length,
    )
    expect(
      new Set(effort2Node.portPoints.map((point) => point.connectionName)).size,
    ).toBe(1)
    expect(
      JSON.stringify(
        effort2Node.portPoints.map((point) => point.connectionName),
      ),
    ).not.toBe(
      JSON.stringify(
        explicit8mmNode.portPoints.map((point) => point.connectionName),
      ),
    )
    expect(effort2Metadata?.solverType).toBe(
      "SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost",
    )
  },
  { timeout: 120_000 },
)
