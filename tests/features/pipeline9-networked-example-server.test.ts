import { expect, test } from "bun:test"
import type {
  Pipeline9NetworkedSolveBatchRequest,
  Pipeline9NetworkedSolveRequest,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/pipeline9-networked-types"
import { ExampleHdCache2Server } from "tests/fixtures/example-hd-cache2-server"
import {
  createNetworkedHighDensitySolver,
  createNetworkedNode,
  solveNetworkedHighDensitySolver,
} from "tests/fixtures/pipeline9-networked-fixtures"

test("Pipeline9 uses the no-cache example server and preserves route metadata", async () => {
  const server = new ExampleHdCache2Server()
  try {
    const node = createNetworkedNode({
      nodeId: "cmn_example_server",
      connectionName: "A",
    })
    const solver = createNetworkedHighDensitySolver({
      nodes: [node],
      hdCache2ServerUrl: server.url,
    })

    await solveNetworkedHighDensitySolver(solver)

    expect(solver.solved).toBeTrue()
    expect(solver.failed).toBeFalse()
    expect(server.batchRequests).toHaveLength(1)
    expect(server.solveRequests).toHaveLength(1)

    const batchRequest = server.batchRequests[0]!
      .body as Pipeline9NetworkedSolveBatchRequest
    const solveRequest = server.solveRequests[0]!
      .body as Pipeline9NetworkedSolveRequest
    expect(batchRequest.items).toHaveLength(1)
    expect(
      batchRequest.items[0]!.input.nodeWithPortPoints.capacityMeshNodeId,
    ).toBe(node.capacityMeshNodeId)
    expect(solveRequest.input).toEqual(batchRequest.items[0]!.input)
    expect(solveRequest.input).toMatchObject({
      effort: 1,
      nodeWithPortPoints: { capacityMeshNodeId: node.capacityMeshNodeId },
    })

    expect(solver.routes).toHaveLength(1)
    expect(solver.routes[0]).toMatchObject({
      connectionName: "A",
      rootConnectionName: "root_A",
      startPcbPortId: "cmn_example_server_start",
      endPcbPortId: "cmn_example_server_end",
      traceThickness: 0.15,
      viaDiameter: 0.3,
    })
    expect(solver.routes[0]!.route[0]).toMatchObject({ x: -2, y: 0, z: 0 })
    expect(solver.routes[0]!.route.at(-1)).toMatchObject({ x: 2, y: 0, z: 0 })
    expect(solver.stats).toMatchObject({
      remoteBatchCacheMisses: 1,
      remoteSingleRequestsStarted: 1,
      remoteSolverResults: 1,
      remoteSolvedResults: 1,
      remoteOrdinaryResults: 1,
      remoteTransportFallbacks: 0,
    })
  } finally {
    await server.close()
  }
})
