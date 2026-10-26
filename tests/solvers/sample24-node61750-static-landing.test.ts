import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import {
  Pipeline9HighDensitySolver,
  type Pipeline9HighDensitySolverParams,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { createPipeline9PhysicalRouteValidator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9PhysicalRouteValidator"
import { createPipeline9StaticSegmentValidator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9StaticSegmentValidator"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import type { SimpleRouteJson } from "lib/types"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("sample24 node61750 reaches its existing boundary-grid via landing without a new routing strategy", (): void => {
  const fixture = JSON.parse(
    readFileSync(
      new URL(
        "../fixtures/sample24/node61750-static-landing.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as {
    provenance: {
      originalInputSha256: string
      originalRawObstacleCount: number
      selectedRawObstacleIndices: number[]
      sourceNodeId: string
    }
    node: NodeWithPortPoints
    parameters: Pick<
      Pipeline9HighDensitySolverParams,
      | "layerCount"
      | "allowBlindAndBuriedVias"
      | "viaDiameter"
      | "viaHoleDiameter"
      | "minViaHoleEdgeToViaHoleEdgeClearance"
      | "traceWidth"
      | "obstacleMargin"
      | "effort"
      | "includeBoardObstacles"
      | "preserveTerminalPcbPortIds"
    >
    nodePf: number
    physicalSrj: SimpleRouteJson
  }
  const original = structuredClone(fixture)
  expect(fixture.provenance.originalInputSha256).toBe(
    "ba157c96251e5c53964a7fb529981fc19347865c82379558bf820fcdef6b52a7",
  )
  expect(fixture.provenance.originalRawObstacleCount).toBe(4418)
  expect(fixture.provenance.sourceNodeId).toBe("topology_merge_61750")
  expect(fixture.physicalSrj.obstacles).toHaveLength(24)
  const { node, parameters, physicalSrj } = fixture
  const minX = node.center.x - node.width / 2
  const maxY = node.center.y + node.height / 2
  const foreignPad = physicalSrj.obstacles.find(
    (obstacle) =>
      obstacle.circuitJsonMetadata?.pcb_smtpad_id === "pcb_smtpad_altium_7460",
  )!
  const strictMaxX =
    foreignPad.center.x -
    foreignPad.width / 2 -
    parameters.viaDiameter / 2 -
    0.1
  // 0.00000204 mm is a 2.04 nm strict band; keep every source coordinate.
  expect(strictMaxX - minX).toBeCloseTo(0.00000204, 11)
  const staticValid = createPipeline9StaticSegmentValidator(physicalSrj)
  const identity = {
    connectionName: "source_net_altium_pcb_136",
    rootConnectionName: "source_net_altium_pcb_136",
    traceThickness: parameters.traceWidth,
    viaDiameter: parameters.viaDiameter,
  }
  const strictPoint = { x: minX + 0.000001, y: 69.83 }
  expect(
    staticValid({
      ...identity,
      start: { ...strictPoint, z: 5 },
      end: { ...strictPoint, z: 7 },
    }),
  ).toBe(true)
  expect(
    foreignPad.center.x -
      foreignPad.width / 2 -
      strictPoint.x -
      parameters.viaDiameter / 2,
  ).toBeGreaterThan(0.1)
  expect(
    staticValid({
      ...identity,
      start: { x: minX, y: maxY, z: 5 },
      end: { x: minX, y: maxY, z: 7 },
    }),
  ).toBe(false)

  const connMap = getConnectivityMapFromSimpleRouteJson(physicalSrj, {
    includeGeometricPointConnections: false,
  })
  const solver = new Pipeline9HighDensitySolver({
    ...parameters,
    nodePortPoints: [node],
    fixedHdRoutes: [],
    connMap,
    colorMap: {},
    boardGeometry: { bounds: physicalSrj.bounds, outline: physicalSrj.outline },
    obstacles: physicalSrj.obstacles,
    physicalSrj,
    nodePfById: new Map([[node.capacityMeshNodeId, fixture.nodePf]]),
  })
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.stats.fallbackNodeCount).toBe(0)
  expect(solver.stats.regularNodeCount).toBe(1)
  expect(solver.routes).toHaveLength(1)
  const route = solver.routes[0]!
  expect(route.connectionName).toBe(identity.connectionName)
  expect(route.rootConnectionName).toBe(identity.rootConnectionName)
  expect(route.vias).toHaveLength(1)
  expect(route.vias[0]!.x).toBe(minX)
  expect(route.vias[0]!.y).toBeGreaterThan(node.center.y + node.height / 4)
  expect(route.vias[0]!.y).toBeLessThan(maxY - 0.002)
  expect(route.route[0]).toMatchObject({
    x: node.portPoints[0]!.x,
    y: node.portPoints[0]!.y,
    z: node.portPoints[0]!.z,
  })
  expect(route.route.at(-1)).toMatchObject({
    x: node.portPoints[1]!.x,
    y: node.portPoints[1]!.y,
    z: node.portPoints[1]!.z,
  })
  expect(
    createPipeline9PhysicalRouteValidator({
      physicalSrj,
      connMap,
      obstacleMargin: parameters.obstacleMargin,
      viaHoleDiameter: parameters.viaHoleDiameter,
    })(solver.routes),
  ).toBe(true)
  expect(fixture).toEqual(original)
})
