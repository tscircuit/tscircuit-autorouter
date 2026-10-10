import { expect, spyOn, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AUTOROUTER_VERSION } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/autorouterVersion"
import { Pipeline9NetworkedHighDensityRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/Pipeline9NetworkedHighDensityRepairSolver"
import { solvePipeline9NetworkedHighDensityNode } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/solvePipeline9NetworkedHighDensityNode"
import type { Pipeline9NetworkedHighDensityRepairInput } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/pipeline9NetworkedRepairTypes"
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import type { HighDensityRoute, NodeWithPortPoints } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

test("single-via trivial repair synchronizes exact geometry and defers possible conflicts", async (): Promise<void> => {
  const transition = { x: 0.123456, y: 0.100345 }
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "single-via",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0, 1],
    portPoints: [],
  }
  const owned: HighDensityRoute = {
    regionId: node.capacityMeshNodeId,
    connectionName: "owned",
    rootConnectionName: "net",
    startPcbPortId: "start",
    endPcbPortId: "end",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [{ x: -1, y: 0, z: 0 }, { ...transition, z: 0 }, { ...transition, z: 1 }, { x: 1, y: 0, z: 1 }],
    vias: [{ x: 0.123, y: 0.1 }],
  }
  const fixed: HighDensityRoute = {
    connectionName: "fixed",
    rootConnectionName: "net",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [{ x: -2, y: 0.2, z: 0 }, { x: 2, y: 0.2, z: 0 }],
    vias: [],
  }
  const obstacle: Obstacle = {
    type: "rect",
    center: { ...transition },
    width: 0.1,
    height: 0.1,
    layers: ["top"],
    connectedTo: ["pad"],
  }
  let singleRequests = 0
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(Object.assign(
    async (url: string | URL | Request, options?: RequestInit): Promise<Response> => {
      const body = JSON.parse(String(options!.body))
      if (String(url).endsWith("/solve-batch")) {
        return new Response(body.items.map(({ requestId }: { requestId: string }) => JSON.stringify({
          requestId,
          ok: false,
          code: "CACHE_MISS",
          autorouterVersion: AUTOROUTER_VERSION,
          message: "cold repair cache",
        })).join("\n") + "\n")
      }
      singleRequests += 1
      const output = solvePipeline9NetworkedHighDensityNode(body.input as Pipeline9NetworkedHighDensityRepairInput)
      return Response.json({ ok: true, autorouterVersion: AUTOROUTER_VERSION, source: "solver", ...output })
    },
    { preconnect: globalThis.fetch.preconnect },
  ))
  try {
    for (const scenario of ["rounded", "missing", "fixed-via", "foreign-net", "foreign-pad", "two-created"] as const) {
      const scenarioOwned = structuredClone(owned)
      const scenarioFixed = structuredClone(fixed)
      const scenarioObstacle = structuredClone(obstacle)
      if (scenario === "missing") scenarioOwned.vias = []
      if (scenario === "fixed-via") {
        scenarioFixed.route = [{ x: -2, y: 0.2, z: 0 }, { x: 0.124, y: 0.1, z: 0 }, { x: 0.124, y: 0.1, z: 1 }, { x: 2, y: 0.2, z: 1 }]
        scenarioFixed.vias = [{ x: 0.124, y: 0.1 }]
      }
      if (scenario === "foreign-net") {
        scenarioFixed.connectionName = "foreign"
        scenarioFixed.rootConnectionName = "foreign-net"
      }
      if (scenario === "foreign-pad") scenarioObstacle.connectedTo = []
      if (scenario === "two-created") {
        scenarioOwned.vias = []
        scenarioOwned.route = [...scenarioOwned.route.slice(0, 3), { x: 0.6, y: 0.1, z: 1 }, { x: 0.6, y: 0.1, z: 0 }, { x: 1, y: 0, z: 0 }]
      }
      const params = {
        nodeWithPortPoints: [node],
        hdRoutes: [scenarioOwned, scenarioFixed],
        obstacles: [scenarioObstacle],
        minimumTraceWidth: 0.2,
        connMap: new ConnectivityMap({ net: ["net", "owned", "fixed", "pad"], "foreign-net": ["foreign-net", "foreign"] }),
      }
      const originalRoutes = structuredClone(params.hdRoutes)
      const local = new Pipeline4HighDensityRepairSolver(params)
      local.solve()
      const remote = new Pipeline9NetworkedHighDensityRepairSolver({
        ...params,
        autorouterVersion: AUTOROUTER_VERSION,
        hdCache2ServerUrl: "http://127.0.0.1:1",
      })
      const requestsBefore = singleRequests
      while (!remote.solved && !remote.failed) {
        remote.step()
        for (const effect of remote.pendingEffects ?? []) await effect.promise
      }
      await remote.waitForAllRemoteRequests()
      const trivial = scenario === "rounded" || scenario === "missing"
      expect(remote.solved, scenario).toBeTrue()
      expect(remote.getOutput(), scenario).toEqual(local.getOutput())
      expect(singleRequests - requestsBefore, scenario).toBe(trivial ? 0 : 1)
      expect(remote.stats.localTrivialRepairCount, scenario).toBe(trivial ? 1 : 0)
      expect(remote.stats.remoteTransportFallbacks, scenario).toBe(0)
      for (const stat of ["nodeClearanceInitialConflictCount", "nodeClearanceFinalConflictCount", "nodeClearanceCandidateCount"] as const) {
        expect(remote.stats[stat], scenario).toBe(local.stats[stat])
        if (trivial) expect(remote.stats[stat], scenario).toBe(0)
      }
      if (trivial) expect(remote.getOutput()[0]!.vias).toEqual([{ ...transition }])
      expect(params.hdRoutes, scenario).toEqual(originalRoutes)
    }
  } finally {
    fetchSpy.mockRestore()
  }
})
