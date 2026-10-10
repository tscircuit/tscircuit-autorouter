import { expect, spyOn, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AUTOROUTER_VERSION } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/autorouterVersion"
import { Pipeline9NetworkedHighDensityRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/Pipeline9NetworkedHighDensityRepairSolver"
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import type { HighDensityRoute, NodeWithPortPoints } from "lib/types/high-density-types"

test("same-net traces and connected pads finish repair without HTTP, even beside fixed vias", async () => {
  const nodes: NodeWithPortPoints[] = [0, 2, 4].map((x, index) => ({
    capacityMeshNodeId: `node-${index}`,
    center: { x, y: 0 },
    width: 2,
    height: 2,
    portPoints: [],
  }))
  const routes: HighDensityRoute[] = nodes.map((node, index) => ({
    regionId: node.capacityMeshNodeId,
    connectionName: `branch-${index}`,
    rootConnectionName: "board-net",
    startPcbPortId: `start-${index}`,
    endPcbPortId: `end-${index}`,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [{ x: node.center.x - 1, y: 0, z: 0 }, { x: node.center.x + 1, y: 0, z: 0 }],
    vias: [],
  }))
  // This route spans the nodes and remains unassigned. Its same-net via is
  // immutable copper in each sample, which cannot conflict with owned traces.
  routes.push({
    connectionName: "fixed-branch",
    rootConnectionName: "board-net",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [{ x: -1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 2, y: 0, z: 1 }, { x: 5, y: 0, z: 1 }],
    vias: [{ x: 2, y: 0 }],
  })
  const params = {
    nodeWithPortPoints: nodes,
    hdRoutes: routes,
    minimumTraceWidth: 0.4,
    obstacles: nodes.map((node, index) => ({
      type: "rect" as const,
      center: node.center,
      width: 2.1,
      height: 0.2,
      layers: ["top"],
      connectedTo: [`pad-${index}`],
    })),
    connMap: new ConnectivityMap({ "board-net": [...routes.map((route) => route.connectionName), "pad-0", "pad-1", "pad-2"] }),
  }
  const local = new Pipeline4HighDensityRepairSolver(params)
  local.solve()
  const remote = new Pipeline9NetworkedHighDensityRepairSolver({
    ...params,
    autorouterVersion: AUTOROUTER_VERSION,
    hdCache2ServerUrl: "http://127.0.0.1:1",
  })
  expect(remote.sampleEntries).toHaveLength(3)
  expect(remote.sampleEntries.every(({ sample }) => sample.fixedHdRoutes!.some((route) => route.vias!.length > 0))).toBeTrue()
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(Object.assign(
    () => { throw new Error("Trivial repair must not send HTTP") },
    { preconnect: globalThis.fetch.preconnect },
  ))
  try {
    while (!remote.solved && !remote.failed) {
      remote.step()
      for (const effect of remote.pendingEffects ?? []) await effect.promise
    }
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(remote.solved).toBeTrue()
    expect(remote.getOutput()).toEqual(local.getOutput())
    expect(remote.stats).toMatchObject({
      localTrivialRepairCount: 3,
      remoteRequestsStarted: 0,
      remoteBatchRequestsStarted: 0,
      repairedNodeCount: 3,
      repairedRouteCount: 3,
      nodeClearanceInitialConflictCount: 0,
      nodeClearanceFinalConflictCount: 0,
      nodeClearanceCandidateCount: 0,
    })
  } finally {
    await remote.waitForAllRemoteRequests()
    fetchSpy.mockRestore()
  }
})
