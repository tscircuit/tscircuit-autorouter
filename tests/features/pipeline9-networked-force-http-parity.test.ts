import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AUTOROUTER_VERSION } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/autorouterVersion"
import { Pipeline9NetworkedHighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/Pipeline9NetworkedHighDensitySolver"
import { forceImprovePipeline9HighDensityNodeRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/forceImprovePipeline9HighDensityNodeRoutes"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { ExampleHdCache2Server } from "tests/fixtures/example-hd-cache2-server"
import { createNetworkedNode, solveNetworkedHighDensitySolver } from "tests/fixtures/pipeline9-networked-fixtures"

test("remote force results preserve fractional terminals and reject unproved post-processing", async (): Promise<void> => {
  const node = createNetworkedNode({ nodeId: "fractional", connectionName: "signal", xOffset: 0.123456 })
  const params = {
    nodePortPoints: [node],
    fixedHdRoutes: [],
    connMap: new ConnectivityMap({ root_signal: ["root_signal", "signal"] }),
    obstacles: [],
    layerCount: 2,
    viaDiameter: 0.3,
    traceWidth: 0.15,
    obstacleMargin: 0.15,
    effort: 1,
    preserveTerminalPcbPortIds: true,
    enableRegionalFallback: false,
  }
  const local = new Pipeline9HighDensitySolver(params)
  local.solve()
  expect(local.solved).toBeTrue()
  const forceImprove = {
    totalStepsPerNode: 20,
    nodeAssignmentMargin: 0.2,
    preserveTerminalPcbPortIds: true,
  }
  const expected = forceImprovePipeline9HighDensityNodeRoutes({
    nodeWithPortPoints: node,
    hdRoutes: local.routes,
    colorMap: {},
    ...forceImprove,
  })
  for (const omitMarker of [false, true]) {
    const server = new ExampleHdCache2Server({
      batchItemMode: "solve",
      mapBatchLine: (line) => {
        if (omitMarker) delete line.forceImproved
        return line
      },
    })
    const remote = new Pipeline9NetworkedHighDensitySolver({
      ...params,
      autorouterVersion: AUTOROUTER_VERSION,
      hdCache2ServerUrl: server.url,
      forceImprove,
    })
    try {
      await solveNetworkedHighDensitySolver(remote)
      expect(remote.solved, remote.error ?? "").toBeTrue()
      if (omitMarker) {
        expect(remote.forceImprovedRegionIds.size).toBe(0)
        expect(remote.stats.remoteTransportFallbacks).toBe(1)
        expect(remote.routes).toEqual(local.routes)
      } else {
        expect(remote.forceImprovedRegionIds.has(node.capacityMeshNodeId)).toBeTrue()
        expect(remote.stats.remoteTransportFallbacks).toBe(0)
        expect(remote.routes).toEqual(expected)
        expect(remote.routes[0]!.startPcbPortId).toBe("fractional_start")
        expect(remote.routes[0]!.endPcbPortId).toBe("fractional_end")
        expect(remote.routes[0]!.route[0]!.x).toBe(-1.877)
      }
    } finally {
      await server.close()
    }
  }
})
