import { expect, test } from "bun:test"
import { AUTOROUTER_VERSION } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/autorouterVersion"
import { HdCache2Client } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/HdCache2Client"
import { PIPELINE9_NETWORKED_SOLVE_POLICY, type Pipeline9NetworkedHighDensityNodeInput } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/pipeline9NetworkedTypes"
import { ExampleHdCache2Server } from "tests/fixtures/example-hd-cache2-server"

test("force-improved plated-hole transitions remain valid remote results", async (): Promise<void> => {
  const input: Pipeline9NetworkedHighDensityNodeInput = {
    solvePolicy: PIPELINE9_NETWORKED_SOLVE_POLICY,
    enableRegionalFallback: true,
    nodeWithPortPoints: {
      capacityMeshNodeId: "plated-hole",
      center: { x: 0, y: 0 },
      width: 2,
      height: 2,
      availableZ: [0, 1],
      portPoints: [
        { x: 0, y: 0, z: 0, connectionName: "signal", pcb_port_id: "start" },
        { x: 0, y: 0, z: 1, connectionName: "signal", pcb_port_id: "end" },
      ],
    },
    connectivityNetMap: { signal: ["signal"] },
    colorMap: {},
    viaDiameter: 0.3,
    traceWidth: 0.15,
    obstacleMargin: 0.15,
    effort: 1,
    obstacles: [{
      type: "rect",
      center: { x: 0, y: 0 },
      width: 2,
      height: 2,
      layers: ["top", "bottom"],
      connectedTo: ["signal"],
    }],
    regionalObstacles: [],
    layerCount: 2,
    nodePf: 0.1,
    forceImprove: {
      totalStepsPerNode: 20,
      nodeAssignmentMargin: 0.2,
      preserveTerminalPcbPortIds: true,
    },
  }
  const server = new ExampleHdCache2Server({ batchItemMode: "solve" })
  try {
    const client = new HdCache2Client(AUTOROUTER_VERSION, server.url)
    const [result] = await Promise.all(client.solveMany([input]))
    expect(result!.kind).toBe("remote")
    if (result!.kind !== "remote" || result!.response.status !== "solved") {
      throw new Error("Expected a solved force-improved result")
    }
    expect(result!.response.forceImproved).toBeTrue()
    expect(result!.response.routes[0]!.route[0]!.toNextSegmentType).toBe("through_obstacle")
    expect(result!.response.routes[0]!.vias).toEqual([{ x: 0, y: 0 }])
    expect(result!.response.routes[0]!.startPcbPortId).toBe("start")
    expect(result!.response.routes[0]!.endPcbPortId).toBe("end")
  } finally {
    await server.close()
  }
})
