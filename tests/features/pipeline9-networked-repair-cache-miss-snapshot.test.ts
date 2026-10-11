import { expect, test } from "bun:test"
import { HdCache2Client } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/HdCache2Client"
import {
  PIPELINE9_NETWORKED_REPAIR_POLICY,
  type Pipeline9NetworkedHighDensityRepairInput,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/pipeline9NetworkedRepairTypes"
import type {
  Pipeline9NetworkedSolveBatchRequest,
  Pipeline9NetworkedSolveRequest,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/pipeline9NetworkedTypes"

test("repair cache misses retain the original route and fixed copper snapshot", async (): Promise<void> => {
  const route = {
    connectionName: "signal",
    traceThickness: 0.1,
    viaDiameter: 0.5,
    route: [
      { x: -1, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ],
    vias: [],
  }
  const input: Pipeline9NetworkedHighDensityRepairInput = {
    solvePolicy: PIPELINE9_NETWORKED_REPAIR_POLICY,
    repairMargin: 0.2,
    sample: {
      nodeWithPortPoints: {
        center: { x: 0, y: 0 },
        width: 2,
        height: 2,
        portPoints: [],
      },
      nodeHdRoutes: [route],
      fixedHdRoutes: [{ ...route, connectionName: "fixed" }],
      adjacentObstacles: [],
      clearanceObstacles: [],
    },
  }
  const singleInputs: Pipeline9NetworkedHighDensityRepairInput[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request): Promise<Response> {
      if (new URL(request.url).pathname === "/solve-batch") {
        const body =
          (await request.json()) as Pipeline9NetworkedSolveBatchRequest<Pipeline9NetworkedHighDensityRepairInput>
        return new Response(
          body.items
            .map((item) =>
              JSON.stringify({
                requestId: item.requestId,
                ok: false,
                autorouterVersion: "test-version",
                code: "CACHE_MISS",
                message: "Not cached",
              }),
            )
            .join("\n"),
        )
      }
      const body =
        (await request.json()) as Pipeline9NetworkedSolveRequest<Pipeline9NetworkedHighDensityRepairInput>
      singleInputs.push(body.input)
      return Response.json({
        ok: true,
        autorouterVersion: "test-version",
        source: "solver",
        status: "solved",
        solutionStage: "repair",
        repairedRoutes: body.input.sample.nodeHdRoutes,
        clearanceStats: {
          nodeClearanceInitialConflictCount: 0,
          nodeClearanceFinalConflictCount: 0,
          nodeClearanceCandidateCount: 0,
        },
      })
    },
  })
  try {
    const client = new HdCache2Client(
      "test-version",
      `http://127.0.0.1:${server.port}`,
    )
    const results = client.solveMany([input])
    route.route[0]!.x = -5
    input.sample.fixedHdRoutes![0]!.connectionName = "mutated-fixed"
    const [result] = await Promise.all(results)
    expect(result.kind).toBe("remote")
    expect(singleInputs).toHaveLength(1)
    expect(singleInputs[0]!.sample.nodeHdRoutes![0]!.route![0]!.x).toBe(-1)
    expect(singleInputs[0]!.sample.fixedHdRoutes![0]!.connectionName).toBe(
      "fixed",
    )
    expect(client.stats.batchCacheMisses).toBe(1)
    expect(client.stats.singleRequestsStarted).toBe(1)
  } finally {
    await server.stop(true)
  }
})
