import { expect, test } from "bun:test"
import { AUTOROUTER_VERSION } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/autorouterVersion"
import { Pipeline9NetworkedHighDensityRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/Pipeline9NetworkedHighDensityRepairSolver"

test("a remote terminal repair failure stops before applying the sample", async () => {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request): Promise<Response> {
      const body = await request.json()
      return new Response(
        body.items
          .map(({ requestId }: { requestId: string }) =>
            JSON.stringify({
              requestId,
              ok: true,
              autorouterVersion: AUTOROUTER_VERSION,
              source: "solver",
              solutionStage: "repair",
              status: "failed",
              error: "repair failed for node",
            }),
          )
          .join("\n") + "\n",
      )
    },
  })
  const route = {
    regionId: "node",
    connectionName: "trace",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: -1, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ],
    vias: [],
  }
  const solver = new Pipeline9NetworkedHighDensityRepairSolver({
    nodeWithPortPoints: [
      {
        capacityMeshNodeId: "node",
        center: { x: 0, y: 0 },
        width: 2,
        height: 2,
        portPoints: [],
      },
    ],
    hdRoutes: [route],
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0.8 },
        width: 0.1,
        height: 0.1,
        layers: ["top"],
        connectedTo: [],
      },
    ],
    autorouterVersion: AUTOROUTER_VERSION,
    hdCache2ServerUrl: server.url.toString(),
  })
  try {
    while (!solver.solved && !solver.failed) {
      solver.step()
      for (const effect of solver.pendingEffects ?? []) await effect.promise
    }
    expect(solver.failed).toBeTrue()
    expect(solver.solved).toBeFalse()
    expect(solver.error).toBe("repair failed for node")
    expect(solver.activeSubSolver).toBeNull()
    expect(solver.stats.repairedRouteCount).toBe(0)
    expect(solver.stats.remoteTransportFallbacks).toBe(0)
    expect(solver.getOutput()).toEqual([route])
  } finally {
    await solver.waitForAllRemoteRequests()
    await server.stop(true)
  }
})
