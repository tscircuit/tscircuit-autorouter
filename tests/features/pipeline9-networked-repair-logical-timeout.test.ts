import { expect, test } from "bun:test"
import { AUTOROUTER_VERSION } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/autorouterVersion"
import { Pipeline9NetworkedHighDensityRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/Pipeline9NetworkedHighDensityRepairSolver"
import { createDeferred } from "tests/fixtures/pipeline9-networked-fixtures"

test("repair uses its local sample at the logical deadline and ignores a late failure", async () => {
  const release = createDeferred<void>()
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request): Promise<Response> {
      const body = await request.json()
      await release.promise
      return new Response(body.items.map(({ requestId }: { requestId: string }) => JSON.stringify({
        requestId,
        ok: true,
        autorouterVersion: AUTOROUTER_VERSION,
        source: "solver",
        solutionStage: "repair",
        status: "failed",
        error: "late repair failure",
      })).join("\n") + "\n")
    },
  })
  const route = {
    regionId: "node",
    connectionName: "trace",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [{ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }],
    vias: [],
  }
  const solver = new Pipeline9NetworkedHighDensityRepairSolver({
    nodeWithPortPoints: [{ capacityMeshNodeId: "node", center: { x: 0, y: 0 }, width: 2, height: 2, portPoints: [] }],
    hdRoutes: [route],
    obstacles: [{ type: "rect", center: { x: 0, y: 0.8 }, width: 0.1, height: 0.1, layers: ["top"], connectedTo: [] }],
    autorouterVersion: AUTOROUTER_VERSION,
    hdCache2ServerUrl: server.url.toString(),
    requestTimeoutMs: 10,
  })
  try {
    while (!solver.solved && !solver.failed) {
      solver.step()
      for (const effect of solver.pendingEffects ?? []) await effect.promise
    }
    expect(solver.solved).toBeTrue()
    expect(solver.stats).toMatchObject({
      remoteRepairResultsApplied: 0,
      remoteLogicalTimeoutFallbacks: 1,
      remoteFallbackReasonCounts: { logical_timeout: 1 },
    })
    release.resolve()
    await solver.waitForAllRemoteRequests()
    expect(solver.failed).toBeFalse()
    expect(solver.getOutput()).toEqual([route])
    expect(solver.stats.remoteFailedResults).toBe(1)
  } finally {
    release.resolve()
    await solver.waitForAllRemoteRequests()
    await server.stop(true)
  }
})
