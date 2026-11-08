import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
import { getPipeline9NetByConnectionName } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9NetByConnectionName"
import { arePipeline9RoutesOnSameNet } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import {
  UniformPortDistributionSolver,
  type UniformPortDistributionSolverInput,
} from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import { getHdRouteNetId } from "lib/utils/getHdRouteNetId"
import { renderRvboyRoutingView } from "../../fixtures/bug-reports/rvboy-escape-via-span/renderRvboyRoutingView"

test("RVboy retained ground keeps its canonical identity across alias collisions", async (): Promise<void> => {
  // Full, unmodified spacing input from the normal TSX build. Only the drawing
  // is cropped; all 3,033 regions and 600 retained route pieces are solved.
  const captured = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/rvboy-uniform-canonical-ground.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  ) as Omit<UniformPortDistributionSolverInput, "connMap"> & {
    connMap: { netMap: ConnectivityMap["netMap"] }
  }
  const original = JSON.stringify(captured)
  const connMap = new ConnectivityMap(captured.connMap.netMap)
  const retained = captured.preloadedRoutes!.find(
    (route) => route.connectionName === "source_trace_30_fixed_90_0",
  )!
  const portId = "ce27765_pp0_z0_cramped::0"
  const port = captured.nodeWithPortPoints
    .flatMap((node) => node.portPoints)
    .find((point) => point.portPointId === portId)!
  const groundNet = getHdRouteNetId(port, connMap)!
  expect(groundNet).toBe("connectivity_net110")
  // Historical aliases are still valid for source IDs, but a retained route's
  // explicit canonical root must not be sent through the alias lookup again.
  expect(connMap.getNetConnectedToId(retained.rootConnectionName!)).toBe(
    "connectivity_net139",
  )
  expect(getHdRouteNetId(retained, connMap)).toBe(groundNet)
  const groundBranch = { ...retained, ...port }
  expect(
    arePipeline9RoutesOnSameNet(retained, groundBranch, connMap),
  ).toBeTrue()
  const foreignRoute = {
    ...retained,
    connectionName: "foreign-retained-piece",
    rootConnectionName: "connectivity_net139",
  }
  expect(
    arePipeline9RoutesOnSameNet(retained, foreignRoute, connMap),
  ).toBeFalse()
  expect(
    getPipeline9NetByConnectionName([retained, foreignRoute], connMap).get(
      retained.connectionName,
    ),
  ).toBe(groundNet)

  const solver = new UniformPortDistributionSolver({ ...captured, connMap })
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const outputPort = solver
    .getOutput()
    .flatMap((node) => node.portPoints)
    .find((point) => point.portPointId === portId)!
  expect(outputPort).toBeDefined()
  expect(getHdRouteNetId(outputPort, connMap)).toBe(groundNet)
  expect(JSON.stringify(captured)).toBe(original)

  const viewbox = { minX: -31.9, maxX: -30.6, minY: -33.15, maxY: -31.8 }
  for (const name of ["before", "after"] as const) {
    const graphics: GraphicsObject = {
      rects: [],
      lines: [],
      circles: [],
      points: [],
    }
    for (const route of captured.preloadedRoutes!) {
      const net =
        name === "before"
          ? (connMap.getNetConnectedToId(route.connectionName) ??
            connMap.getNetConnectedToId(route.rootConnectionName!))
          : getHdRouteNetId(route, connMap)
      const sameNet = net === groundNet
      for (let i = 1; i < route.route.length; i++) {
        const a = route.route[i - 1]!,
          b = route.route[i]!
        if (a.z !== 0 || b.z !== 0) continue
        const width = a.traceThickness ?? route.traceThickness
        if (!sameNet)
          graphics.lines!.push({
            points: [a, b],
            strokeWidth:
              width + captured.minTraceWidth! + 2 * captured.traceClearance!,
            strokeColor: "#ef444433",
          })
        graphics.lines!.push({
          points: [a, b],
          strokeWidth: width,
          strokeColor: sameNet ? "#16a34a" : "#dc2626",
        })
      }
    }
    graphics.circles!.push({
      center: name === "before" ? port : outputPort,
      radius: captured.minTraceWidth! / 2,
      fill: "#2563eb",
      stroke: "#172554",
    })
    await expect(
      renderRvboyRoutingView(
        graphics,
        viewbox,
        "RVboy: retained ground and new ground crossing",
        name === "before"
          ? "Stale alias marks GND as foreign: red exclusion blocks the blue GND crossing"
          : "Canonical identity restores shared GND copper: spacing stage completes",
      ),
    ).toMatchSvgSnapshot(import.meta.path, { svgName: name })
  }
})
