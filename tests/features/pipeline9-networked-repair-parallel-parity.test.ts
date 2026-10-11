import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AUTOROUTER_VERSION } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/autorouterVersion"
import { Pipeline9NetworkedHighDensityRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/Pipeline9NetworkedHighDensityRepairSolver"
import { solvePipeline9NetworkedHighDensityNode } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/solvePipeline9NetworkedHighDensityNode"
import type { Pipeline9NetworkedHighDensityRepairInput } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/pipeline9NetworkedRepairTypes"
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import { createDeferred } from "tests/fixtures/pipeline9-networked-fixtures"

const waitFor = async (condition: () => boolean): Promise<void> => {
  const deadline = performance.now() + 5_000
  while (!condition()) {
    if (performance.now() > deadline)
      throw new Error("Repair requests did not settle")
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

test("parallel repair preserves frozen neighbors, board rules and positional terminal identity", async () => {
  const nodes: NodeWithPortPoints[] = [0, 2, 4].map((x, index) => ({
    capacityMeshNodeId: `node-${index}`,
    center: { x, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0, 1],
    portPoints: [
      { x: x - 1, y: 0, z: 0, connectionName: "bus" },
      { x: x + 1, y: 0, z: 0, connectionName: "bus" },
    ],
  }))
  const routes: HighDensityRoute[] = nodes.map((node, index) => ({
    regionId: node.capacityMeshNodeId,
    connectionName: "bus",
    rootConnectionName: "root-bus",
    startPcbPortId: `start-${index}`,
    endPcbPortId: `end-${index}`,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: node.center.x - 1, y: 0, z: 0 },
      { x: node.center.x, y: 0, z: 0 },
      { x: node.center.x + 1, y: 0, z: 0 },
    ],
    vias: [],
  }))
  const unassignedRoute: HighDensityRoute = {
    connectionName: "fixed-neighbor",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -1, y: 0.85, z: 0 },
      { x: 5, y: 0.85, z: 0 },
    ],
    vias: [],
  }
  routes.push(unassignedRoute)
  const trivialNode: NodeWithPortPoints = {
    capacityMeshNodeId: "trivial-node",
    center: { x: 10, y: 0 },
    width: 2,
    height: 2,
    portPoints: [],
  }
  const trivialRoute: HighDensityRoute = {
    ...routes[0],
    regionId: trivialNode.capacityMeshNodeId,
    startPcbPortId: "trivial-start",
    endPcbPortId: "trivial-end",
    route: [
      { x: 9, y: 0, z: 0 },
      { x: 11, y: 0, z: 0 },
    ],
  }
  const params = {
    nodeWithPortPoints: [nodes[0], trivialNode, ...nodes.slice(1)],
    hdRoutes: [routes[0], trivialRoute, ...routes.slice(1)],
    minimumTraceWidth: 0.4,
    repairMargin: 0.2,
    connMap: new ConnectivityMap({ "root-bus": ["bus", "root-bus"] }),
    obstacles: nodes.map((node) => ({
      type: "rect" as const,
      center: { x: node.center.x, y: 0.3 },
      width: 0.1,
      height: 0.1,
      layers: ["top"],
      connectedTo: [],
    })),
  }
  const local = new Pipeline4HighDensityRepairSolver(params)
  const originalSamples = JSON.parse(
    JSON.stringify(local.sampleEntries.map(({ sample }) => sample)),
  )
  const remoteSamples = originalSamples.filter(
    (sample: { nodeWithPortPoints: { capacityMeshNodeId: string } }) =>
      sample.nodeWithPortPoints.capacityMeshNodeId !==
      trivialNode.capacityMeshNodeId,
  )
  local.solve()
  expect(local.getOutput()[0].route).not.toEqual(routes[0].route)
  expect(
    remoteSamples.every(
      (sample: { fixedHdRoutes: unknown[] }) => sample.fixedHdRoutes.length > 0,
    ),
  ).toBeTrue()

  const releases = nodes.map(() => createDeferred<void>())
  const received: Pipeline9NetworkedHighDensityRepairInput[] = []
  const completed: string[] = []
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request): Promise<Response> {
      const body = await request.json()
      if (new URL(request.url).pathname === "/solve-batch") {
        return new Response(
          body.items
            .map(({ requestId }: { requestId: string }) =>
              JSON.stringify({
                requestId,
                ok: false,
                code: "CACHE_MISS",
                autorouterVersion: AUTOROUTER_VERSION,
                cacheVersion: body.cacheVersion,
                message: "cold repair cache",
              }),
            )
            .join("\n") + "\n",
        )
      }
      const input = body.input as Pipeline9NetworkedHighDensityRepairInput
      received.push(input)
      const nodeIndex = nodes.findIndex(
        (node) =>
          node.capacityMeshNodeId ===
          input.sample.nodeWithPortPoints!.capacityMeshNodeId,
      )
      await releases[nodeIndex].promise
      const output = solvePipeline9NetworkedHighDensityNode(input)
      completed.push(nodes[nodeIndex].capacityMeshNodeId)
      return Response.json({
        ok: true,
        autorouterVersion: AUTOROUTER_VERSION,
        cacheVersion: body.cacheVersion,
        source: "solver",
        ...output,
      })
    },
  })
  const remote = new Pipeline9NetworkedHighDensityRepairSolver({
    ...params,
    autorouterVersion: AUTOROUTER_VERSION,
    hdCache2ServerUrl: server.url.toString(),
    hdCache2CacheVersion: "repair-parity",
    requestTimeoutMs: 5_000,
  })
  try {
    expect(remote.getConstructorParams()[0]).toMatchObject({
      autorouterVersion: AUTOROUTER_VERSION,
      hdCache2ServerUrl: server.url.toString(),
      hdCache2CacheVersion: "repair-parity",
      requestTimeoutMs: 5_000,
    })
    const recreated = new Pipeline9NetworkedHighDensityRepairSolver(
      ...remote.getConstructorParams(),
    )
    expect(recreated.sampleEntries).toEqual(remote.sampleEntries)
    remote.step()
    await waitFor(() => received.length === nodes.length)
    // Concurrent HTTP requests may arrive in any order; each node must still
    // receive its exact frozen sample.
    for (const { sample } of received) {
      expect(sample).toEqual(
        remoteSamples.find(
          (expected: Pipeline9NetworkedHighDensityRepairInput["sample"]) =>
            expected.nodeWithPortPoints!.capacityMeshNodeId ===
            sample.nodeWithPortPoints!.capacityMeshNodeId,
        ),
      )
    }
    for (const index of [2, 1, 0]) {
      releases[index].resolve()
      await waitFor(() => completed.includes(nodes[index].capacityMeshNodeId))
    }
    while (!remote.solved && !remote.failed) {
      remote.step()
      for (const effect of remote.pendingEffects ?? []) await effect.promise
    }
    expect(completed).toEqual(["node-2", "node-1", "node-0"])
    expect(remote.solved).toBeTrue()
    expect(remote.getOutput()).toEqual(local.getOutput())
    expect(remote.getOutput().at(-1)).toBe(unassignedRoute)
    expect(remote.stats).toMatchObject({
      repairedNodeCount: 4,
      repairedRouteCount: 4,
      localTrivialRepairCount: 1,
      remoteRequestsStarted: 3,
      remoteRepairResultsApplied: 3,
      remoteTransportFallbacks: 0,
      nodeClearanceCandidateCount: local.stats.nodeClearanceCandidateCount,
      nodeClearanceInitialConflictCount:
        local.stats.nodeClearanceInitialConflictCount,
      nodeClearanceFinalConflictCount:
        local.stats.nodeClearanceFinalConflictCount,
    })
    expect(routes[0].route).toEqual([
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ])
  } finally {
    for (const release of releases) release.resolve()
    await remote.waitForAllRemoteRequests()
    await server.stop(true)
  }
})
