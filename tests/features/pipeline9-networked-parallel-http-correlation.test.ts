import { expect, test } from "bun:test"
import { ExampleHdCache2Server } from "tests/fixtures/example-hd-cache2-server"
import {
  createDeferred,
  createNetworkedHighDensitySolver,
  createNetworkedNode,
  solveNetworkedHighDensitySolver,
} from "tests/fixtures/pipeline9-networked-fixtures"

const waitFor = async (
  condition: () => boolean,
  message: string,
): Promise<void> => {
  const deadline = performance.now() + 5_000
  while (!condition()) {
    if (performance.now() >= deadline) throw new Error(message)
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

test("Pipeline9 correlates parallel single solves after a batch of misses", async () => {
  const nodes = [
    createNetworkedNode({
      nodeId: "cmn_parallel_a",
      connectionName: "A",
      xOffset: -10,
    }),
    createNetworkedNode({
      nodeId: "cmn_parallel_b",
      connectionName: "B",
    }),
    createNetworkedNode({
      nodeId: "cmn_parallel_c",
      connectionName: "C",
      xOffset: 10,
    }),
  ]
  const releases = new Map(
    nodes.map((node) => [node.capacityMeshNodeId, createDeferred<void>()]),
  )
  const startOrder: string[] = []
  const completionOrder: string[] = []
  const server = new ExampleHdCache2Server({
    beforeSolve: async ({ input }) => {
      const nodeId = input.nodeWithPortPoints.capacityMeshNodeId
      startOrder.push(nodeId)
      await releases.get(nodeId)!.promise
    },
    mapSolveEnvelope: (envelope, { input }) => {
      completionOrder.push(input.nodeWithPortPoints.capacityMeshNodeId)
      return envelope
    },
  })

  try {
    const solver = createNetworkedHighDensitySolver({
      nodes,
      hdCache2ServerUrl: server.url,
    })

    solver.step()
    await waitFor(
      () => startOrder.length === nodes.length,
      "the example server did not start every single-node solve",
    )

    expect(new Set(startOrder)).toEqual(
      new Set(nodes.map((node) => node.capacityMeshNodeId)),
    )
    expect(server.batchRequests).toHaveLength(1)
    expect(server.solveRequests).toHaveLength(nodes.length)
    expect(
      server.solveRequests.every(({ finishedAt }) => !finishedAt),
    ).toBeTrue()

    const releaseOrder = [nodes[1]!, nodes[2]!, nodes[0]!]
    for (const [index, node] of releaseOrder.entries()) {
      releases.get(node.capacityMeshNodeId)!.resolve()
      await waitFor(
        () => completionOrder.length === index + 1,
        `the example server did not finish ${node.capacityMeshNodeId}`,
      )
    }
    await solveNetworkedHighDensitySolver(solver)

    expect(completionOrder).toEqual(
      releaseOrder.map((node) => node.capacityMeshNodeId),
    )
    expect(solver.solved).toBeTrue()
    expect(solver.routes.map(({ connectionName }) => connectionName)).toEqual([
      "C",
      "B",
      "A",
    ])
    expect(
      solver.routes.map(({ rootConnectionName }) => rootConnectionName),
    ).toEqual(["root_C", "root_B", "root_A"])
    expect(solver.stats).toMatchObject({
      remoteRequestsStarted: 3,
      remoteRequestsCompleted: 3,
      remoteBatchCacheMisses: 3,
      remoteSingleRequestsStarted: 3,
      remoteSolverResults: 3,
      remoteTransportFallbacks: 0,
    })
  } finally {
    for (const release of releases.values()) release.resolve()
    await server.close()
  }
})
