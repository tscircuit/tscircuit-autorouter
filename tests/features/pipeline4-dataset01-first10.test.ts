import { expect, test } from "bun:test"
import * as dataset01 from "@tscircuit/autorouting-dataset-01"
import { getGlobalInMemoryCache } from "lib/cache/setupGlobalCaches"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import { ConvexRegionsCapacityMeshNodeSolver } from "lib/solvers/CapacityMeshSolver/ConvexRegionsCapacityMeshNodeSolver"
import type { SimpleRouteJson } from "lib/types"
import { isPointInNode } from "lib/utils/capacityMeshNodeGeometry"

const getDatasetCircuit = (name: string) =>
  (dataset01 as Record<string, unknown>)[name] as SimpleRouteJson

test("pipeline4 dataset01 circuit002 center target obstacle expands availableZ", () => {
  const circuit002 = structuredClone(getDatasetCircuit("circuit002"))
  const sourceNet3 = circuit002.connections.find(
    (connection) => connection.name === "source_net_3",
  )

  expect(sourceNet3).toBeDefined()

  const centerPoint = sourceNet3!.pointsToConnect[2]
  const nodeSolver = new ConvexRegionsCapacityMeshNodeSolver(circuit002)
  nodeSolver.solve()

  const centerTargetNode = nodeSolver
    .getOutput()
    .meshNodes.find(
      (node) =>
        node._containsObstacle &&
        node._containsTarget &&
        isPointInNode(centerPoint, node),
    )

  expect(centerTargetNode).toBeDefined()
  expect(centerTargetNode!.availableZ).toEqual([0, 1])

  getGlobalInMemoryCache().clearCache()

  const solver = new AutoroutingPipelineSolver4(structuredClone(circuit002))
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.error).toBeNull()
})

test(
  "pipeline4 dataset01 first 10 circuits solve under convex default",
  () => {
    const first10CircuitNames = Object.keys(dataset01)
      .filter((name) => /^circuit\d+$/.test(name))
      .sort()
      .slice(0, 10)

    const failures: Array<{ name: string; error: string | null }> = []

    for (const name of first10CircuitNames) {
      getGlobalInMemoryCache().clearCache()

      const solver = new AutoroutingPipelineSolver4(
        structuredClone(getDatasetCircuit(name)),
      )
      solver.solve()

      if (!solver.solved || solver.failed) {
        const errorValue = (solver as { error?: unknown }).error
        const error =
          typeof errorValue === "object" &&
          errorValue !== null &&
          "message" in errorValue
            ? String((errorValue as { message?: unknown }).message ?? "")
            : ((errorValue as string | null | undefined) ?? null)

        failures.push({
          name,
          error,
        })
      }
    }

    expect(first10CircuitNames).toEqual([
      "circuit001",
      "circuit002",
      "circuit003",
      "circuit004",
      "circuit005",
      "circuit006",
      "circuit007",
      "circuit010",
      "circuit011",
      "circuit012",
    ])
    expect(failures).toEqual([])
  },
  { timeout: 180_000 },
)
