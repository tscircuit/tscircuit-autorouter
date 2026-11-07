import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { EscapeViaLocationSolver } from "lib/solvers/EscapeViaLocationSolver/EscapeViaLocationSolver"
import type {
  SimpleRouteConnection,
  SimpleRouteJson,
  SingleLayerConnectionPoint,
} from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { renderRvboyRoutingView } from "../../../fixtures/bug-reports/rvboy-escape-via-span/renderRvboyRoutingView"

test("RVboy emits its reserved ground via after cleanup changes the approach layer", async (): Promise<void> => {
  const fixture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../../fixtures/rvboy-terminal-via-layer.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  ) as {
    srj: SimpleRouteJson
    route: HighDensityRoute
    connection: SimpleRouteConnection
  }
  const solver = new EscapeViaLocationSolver(structuredClone(fixture.srj))
  solver.solve()
  expect(solver.failed).toBe(false)
  const originalTerminal = fixture.connection.pointsToConnect.find(
    (point) => "terminalVia" in point && point.terminalVia,
  )! as SingleLayerConnectionPoint
  const terminal = solver
    .getOutputSimpleRouteJson()
    .connections.flatMap((connection) => connection.pointsToConnect)
    .find(
      (point) => point.pointId === originalTerminal.pointId,
    )! as SingleLayerConnectionPoint
  expect(terminal.terminalVia?.layers).toEqual([
    "top",
    "inner1",
    "inner2",
    "bottom",
  ])
  expect(fixture.route.route.at(-1)!.z).toBe(3)
  const originalRoute = structuredClone(fixture.route)
  const before = convertHdRouteToSimplifiedRoute(fixture.route, 4, {
    connectionPoints: fixture.connection.pointsToConnect,
  })
  const after = convertHdRouteToSimplifiedRoute(fixture.route, 4, {
    connectionPoints: [terminal],
    defaultViaHoleDiameter: 0.2,
  })
  expect(before.at(-1)!.route_type).toBe("wire")
  expect(after.at(-1)).toMatchObject({
    route_type: "via",
    x: terminal.x,
    y: terminal.y,
    from_layer: "bottom",
    to_layer: "inner1",
    via_diameter: 0.45,
    via_hole_diameter: 0.2,
  })
  expect(after.at(-2)).toMatchObject({
    route_type: "wire",
    x: terminal.x,
    y: terminal.y,
    layer: "bottom",
  })
  expect(fixture.route).toEqual(originalRoute)
  // A blind top-to-inner1 via cannot accept a bottom-layer approach.
  const blind = convertHdRouteToSimplifiedRoute(fixture.route, 4, {
    connectionPoints: [
      {
        ...terminal,
        terminalVia: { ...terminal.terminalVia!, layers: ["top", "inner1"] },
      },
    ],
  })
  expect(blind.at(-1)!.route_type).toBe("wire")
  const reversed = { ...fixture.route, route: fixture.route.route.toReversed() }
  expect(
    convertHdRouteToSimplifiedRoute(reversed, 4, {
      connectionPoints: [terminal],
    })[0],
  ).toMatchObject({
    route_type: "via",
    from_layer: "bottom",
    to_layer: "inner1",
  })
  for (const [name, route] of [
    ["before", before],
    ["after", after],
  ] as const) {
    const graphics = convertSrjToGraphicsObject({
      ...fixture.srj,
      obstacles: fixture.srj.obstacles.filter(
        (obstacle) => !obstacle.isCopperPour,
      ),
      connections: [],
      traces: [
        {
          type: "pcb_trace",
          pcb_trace_id: fixture.route.connectionName,
          connection_name: fixture.route.connectionName,
          route,
        },
      ],
    })
    await expect(
      renderRvboyRoutingView(
        graphics,
        { minX: -33.1, maxX: -30.9, minY: -30.85, maxY: -28.75 },
        "RVboy: retain the ground-plane terminal via",
        name === "before"
          ? "Before: bottom-layer wire ends without its reserved via"
          : "After: the bottom-layer approach reaches the inner ground plane",
      ),
    ).toMatchSvgSnapshot(import.meta.path, { svgName: name })
  }
})
