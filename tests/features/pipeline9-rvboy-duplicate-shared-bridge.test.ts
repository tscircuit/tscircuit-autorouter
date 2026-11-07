import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { SimpleRouteJson } from "lib/types"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import {
  repairDisconnectedSameRootPortPoints,
  areNodePortPointPairsConnectedByRoutes,
} from "lib/solvers/HyperHighDensitySolver/repairDisconnectedSameRootPortPoints"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { renderRvboyRoutingView } from "../../fixtures/bug-reports/rvboy-escape-via-span/renderRvboyRoutingView"

test("a shared bridge is copied once for a disjoint port pair and stitches to the RVboy pad", async (): Promise<void> => {
  const captured = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/rvboy-duplicate-shared-bridge.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  ) as {
    repairInput: { routes: HighDensityRoute[]; node: NodeWithPortPoints }
    originalNode: NodeWithPortPoints
    hdRoutes: HighDensityRoute[]
    srj: SimpleRouteJson
  }
  const { repairInput, originalNode, hdRoutes, srj } = captured
  const original = structuredClone(repairInput)
  const repaired = repairDisconnectedSameRootPortPoints(
    repairInput.routes,
    repairInput.node,
  )
  expect(repaired).toHaveLength(repairInput.routes.length + 1)
  expect(
    areNodePortPointPairsConnectedByRoutes(repaired, repairInput.node),
  ).toBe(true)
  expect(repairInput).toEqual(original)
  // The captured portfolio input was enlarged by grow/shrink. Restore the
  // board coordinates exactly as its caller does before handing it to stitching.
  const scale = originalNode.width / repairInput.node.width
  const repairedRegion = repaired.map(
    (route): HighDensityRoute => ({
      ...route,
      route: route.route.map((point) => ({
        ...point,
        x: originalNode.center.x + (point.x - originalNode.center.x) * scale,
        y: originalNode.center.y + (point.y - originalNode.center.y) * scale,
      })),
      vias: route.vias.map((via) => ({
        x: originalNode.center.x + (via.x - originalNode.center.x) * scale,
        y: originalNode.center.y + (via.y - originalNode.center.y) * scale,
      })),
      rootConnectionName: originalNode.portPoints.find(
        (port) => port.connectionName === route.connectionName,
      )!.rootConnectionName,
    }),
  )
  const afterRoutes = [
    ...hdRoutes.filter(
      (route) => route.regionId !== originalNode.capacityMeshNodeId,
    ),
    ...repairedRegion,
  ]
  const viewbox = { minX: 4.1, maxX: 6.7, minY: 8.0, maxY: 10.8 }
  for (const [name, routes] of [
    ["before", hdRoutes],
    ["after", afterRoutes],
  ] as const) {
    const solver = new MultipleHighDensityRouteStitchSolver3({
      connections: srj.connections,
      hdRoutes: routes,
      layerCount: srj.layerCount,
      defaultViaDiameter: 0.45,
      preserveTerminalPcbPortIds: true,
      preferSameLayerTerminalEndpoints: true,
    })
    solver.solve()
    expect(solver.failed).toBe(false)
    const route = solver.mergedHdRoutes.find(
      (route) => route.connectionName === "source_net_62_mst2",
    )!
    const end = route.route.at(-1)!
    if (name === "before") expect(end.z).toBe(3)
    else expect(end).toMatchObject({ x: 6, y: 10.075, z: 0 })
    const graphics = convertSrjToGraphicsObject({
      ...srj,
      connections: [],
      obstacles: srj.obstacles.filter((obstacle) =>
        obstacle.layers.includes("top"),
      ),
      traces: [
        {
          type: "pcb_trace",
          pcb_trace_id: route.connectionName,
          connection_name: route.connectionName,
          route: convertHdRouteToSimplifiedRoute(route, srj.layerCount),
        },
      ],
    })
    graphics.points = []
    graphics.lines = graphics.lines.filter(
      (line) => line.layer === "z0" || line.layer === "z3",
    )
    await expect(
      renderRvboyRoutingView(
        graphics,
        viewbox,
        name === "before"
          ? "Duplicate bridge leaves the pad disconnected"
          : "One bridge reaches the pad on its copper layer",
        "Exact RVboy input, cropped at the affected pad; top red, bottom blue",
      ),
    ).toMatchSvgSnapshot(import.meta.path, { svgName: name })
  }
})
