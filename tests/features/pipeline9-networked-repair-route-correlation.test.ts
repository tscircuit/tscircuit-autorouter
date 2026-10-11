import { expect, test } from "bun:test"
import { HdCache2Client } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/HdCache2Client"
import {
  PIPELINE9_NETWORKED_REPAIR_POLICY,
  type Pipeline9NetworkedHighDensityRepairInput,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/pipeline9NetworkedRepairTypes"
import type { Pipeline9NetworkedSolveBatchRequest } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/pipeline9NetworkedTypes"

test("remote repair rejects reordered routes with the same connection identity", async (): Promise<void> => {
  const input: Pipeline9NetworkedHighDensityRepairInput = {
    solvePolicy: PIPELINE9_NETWORKED_REPAIR_POLICY,
    repairMargin: 0.2,
    sample: {
      nodeWithPortPoints: {
        capacityMeshNodeId: "cell",
        center: { x: 0, y: 0 },
        width: 2,
        height: 2,
        portPoints: [],
      },
      nodeHdRoutes: [-0.5, 0.5].map((y) => ({
        capacityMeshNodeId: "cell",
        connectionName: "same-net",
        rootConnectionName: "same-net",
        traceThickness: 0.1,
        viaDiameter: 0.5,
        route: [
          { x: -1, y, z: 0 },
          { x: 1, y, z: 0 },
        ],
        vias: [],
      })),
      fixedHdRoutes: [],
      adjacentObstacles: [],
      clearanceObstacles: [],
    },
  }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request): Promise<Response> {
      const body =
        (await request.json()) as Pipeline9NetworkedSolveBatchRequest<Pipeline9NetworkedHighDensityRepairInput>
      return new Response(
        body.items
          .map((item) =>
            JSON.stringify({
              requestId: item.requestId,
              ok: true,
              autorouterVersion: "test-version",
              source: "solver",
              status: "solved",
              solutionStage: "repair",
              repairedRoutes: [...item.input.sample.nodeHdRoutes!].reverse(),
              clearanceStats: {
                nodeClearanceInitialConflictCount: 0,
                nodeClearanceFinalConflictCount: 0,
                nodeClearanceCandidateCount: 0,
              },
            }),
          )
          .join("\n"),
      )
    },
  })
  try {
    const client = new HdCache2Client(
      "test-version",
      `http://127.0.0.1:${server.port}`,
    )
    const [result] = await Promise.all(client.solveMany([input]))
    expect(result).toMatchObject({
      kind: "local-fallback",
      reason: "invalid_response",
    })
    expect(client.stats.batchInvalidLines).toBe(1)
  } finally {
    await server.stop(true)
  }
})
