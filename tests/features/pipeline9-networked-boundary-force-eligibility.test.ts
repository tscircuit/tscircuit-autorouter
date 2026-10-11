import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { HighDensityForceImproveSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import { AUTOROUTER_VERSION } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/autorouterVersion"
import { forceImprovePipeline9HighDensityNodeRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/forceImprovePipeline9HighDensityNodeRoutes"
import { isPipeline9NodeForceImprovementEligible } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/isPipeline9NodeForceImprovementEligible"
import { Pipeline9NetworkedHighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/Pipeline9NetworkedHighDensitySolver"
import { Pipeline9RemainingForceImproveSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/Pipeline9RemainingForceImproveSolver"
import { materializePipeline9HdRouteVias } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/materializePipeline9HdRouteVias"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { simplifyPipeline9CollinearRoutePoints } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/simplifyPipeline9CollinearRoutePoints"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import { ExampleHdCache2Server } from "tests/fixtures/example-hd-cache2-server"
import {
  createNetworkedNode,
  solveNetworkedHighDensitySolver,
} from "tests/fixtures/pipeline9-networked-fixtures"

test("boundary plated transitions stay remote raw while remaining force preserves global output", async (): Promise<void> => {
  // Compact circuit104 reproduction: force clamps this plated transition's
  // fixed terminals 0.151 mm inward from the node's top boundary.
  const boundary: NodeWithPortPoints = {
    capacityMeshNodeId: "topology_merge_182",
    center: { x: 14.898025612106915, y: -8.425987193946542 },
    width: 1.5,
    height: 7.148025612106916,
    availableZ: [0, 1],
    portPoints: [
      {
        x: 14.373025612106915,
        y: -4.851974387893083,
        z: 1,
        connectionName: "signal",
        rootConnectionName: "root_signal",
        portPointId: "top",
        nextPortPointId: "bottom",
      },
      {
        x: 14.373025612106915,
        y: -4.851974387893083,
        z: 0,
        connectionName: "signal",
        rootConnectionName: "root_signal",
        portPointId: "bottom",
        prevPortPointId: "top",
      },
    ],
  }
  const ordinary = createNetworkedNode({
    nodeId: "ordinary",
    connectionName: "other",
  })
  const obstacle: Obstacle = {
    type: "rect",
    center: { x: 14.898025612106915, y: -4.101974387893084 },
    width: 1.5,
    height: 1.5,
    layers: ["top", "bottom"],
    zLayers: [0, 1],
    connectedTo: ["signal"],
    circuitJsonMetadata: {
      pcb_plated_hole_id: "pcb_plated_hole_3",
      pcb_port_id: "pcb_port_35",
    },
  }
  const nodes = [boundary, ordinary]
  const params = {
    nodePortPoints: nodes,
    fixedHdRoutes: [],
    connMap: new ConnectivityMap({
      root_signal: ["root_signal", "signal"],
      root_other: ["root_other", "other"],
    }),
    obstacles: [obstacle],
    layerCount: 2,
    viaDiameter: 0.3,
    traceWidth: 0.15,
    obstacleMargin: 0.15,
    effort: 1,
    preserveTerminalPcbPortIds: true,
    enableRegionalFallback: false,
  }
  const forceImprove = { totalStepsPerNode: 20, nodeAssignmentMargin: 0.2 }
  expect(
    isPipeline9NodeForceImprovementEligible({
      nodeWithPortPoints: boundary,
      viaDiameter: 0.3,
    }),
  ).toBeFalse()
  expect(
    isPipeline9NodeForceImprovementEligible({
      nodeWithPortPoints: ordinary,
      viaDiameter: 0.3,
    }),
  ).toBeTrue()
  const interior = structuredClone(boundary)
  for (const point of interior.portPoints) point.y -= 0.2
  expect(
    isPipeline9NodeForceImprovementEligible({
      nodeWithPortPoints: interior,
      viaDiameter: 0.3,
    }),
  ).toBeTrue()

  const local = new Pipeline9HighDensitySolver(params)
  local.solve()
  expect(local.solved).toBeTrue()
  const boundaryRoutes = local.routes.filter(
    (route) => route.regionId === boundary.capacityMeshNodeId,
  )
  expect(boundaryRoutes[0]!.route[0]!.toNextSegmentType).toBe(
    "through_obstacle",
  )
  expect(boundaryRoutes[0]!.route[0]!.y).toBe(boundary.portPoints[0]!.y)
  const forceBoundary = forceImprovePipeline9HighDensityNodeRoutes({
    nodeWithPortPoints: boundary,
    hdRoutes: boundaryRoutes,
    colorMap: {},
    ...forceImprove,
    preserveTerminalPcbPortIds: true,
  })
  expect(forceBoundary[0]!.route[0]!.y).toBe(-5.003)

  const globalForce = new HighDensityForceImproveSolver({
    nodeWithPortPoints: nodes,
    hdRoutes: simplifyPipeline9CollinearRoutePoints(
      materializePipeline9HdRouteVias(local.routes),
    ),
    colorMap: {},
    ...forceImprove,
  })
  globalForce.solve()
  const server = new ExampleHdCache2Server()
  try {
    const remote = new Pipeline9NetworkedHighDensitySolver({
      ...params,
      forceImprove,
      autorouterVersion: AUTOROUTER_VERSION,
      hdCache2ServerUrl: server.url,
    })
    await solveNetworkedHighDensitySolver(remote)
    expect(remote.solved).toBeTrue()
    expect(remote.stats.remoteTransportFallbacks).toBe(0)
    expect(
      remote.forceImprovedRegionIds.has(boundary.capacityMeshNodeId),
    ).toBeFalse()
    expect(
      remote.forceImprovedRegionIds.has(ordinary.capacityMeshNodeId),
    ).toBeTrue()
    expect(
      remote.routes.filter(
        (route) => route.regionId === boundary.capacityMeshNodeId,
      ),
    ).toEqual(boundaryRoutes)
    const requestInputs = server.solveRequests.map(
      ({ body }) =>
        (
          body as {
            input: {
              nodeWithPortPoints: NodeWithPortPoints
              forceImprove?: unknown
            }
          }
        ).input,
    )
    expect(
      requestInputs.find(
        (input) =>
          input.nodeWithPortPoints.capacityMeshNodeId ===
          boundary.capacityMeshNodeId,
      )!.forceImprove,
    ).toBeUndefined()
    expect(
      requestInputs.find(
        (input) =>
          input.nodeWithPortPoints.capacityMeshNodeId ===
          ordinary.capacityMeshNodeId,
      )!.forceImprove,
    ).toBeDefined()
    const remaining = new Pipeline9RemainingForceImproveSolver({
      nodeWithPortPoints: nodes,
      hdRoutes: remote.routes,
      forceImprovedRegionIds: remote.forceImprovedRegionIds,
      colorMap: {},
      ...forceImprove,
    })
    remaining.solve()
    expect(remaining.solved).toBeTrue()
    expect(remaining.getOutput()).toEqual(globalForce.getOutput())
  } finally {
    await server.close()
  }
})
