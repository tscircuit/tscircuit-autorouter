import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { FindClearancePathSolver } from "@tscircuit/repair04"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { preparePipeline9RepairConnectivity } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/preparePipeline9RepairConnectivity"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { renderRvboyRoutingView } from "../../fixtures/bug-reports/rvboy-escape-via-span/renderRvboyRoutingView"

test("RVboy ground repair recognizes retained copper at its shared pad endpoint", async (): Promise<void> => {
  const captured = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/rvboy-negotiated-ground-alias.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  )
  const { input, netMap } = captured as {
    input: Omit<
      ConstructorParameters<typeof FindClearancePathSolver>[0],
      "srj" | "routes"
    > & {
      srj: Omit<SimpleRouteJson, "traces"> & { traces?: undefined }
      routes: HighDensityRoute[]
    }
    netMap: ConnectivityMap["netMap"]
  }
  const original = structuredClone(input)
  const connMap = new ConnectivityMap(netMap)
  const before = new FindClearancePathSolver(input)
  before.solve()
  expect(before.getOutput()).toBeNull()
  expect(before.stats.nodesPopped).toBe(0)
  const prepared = preparePipeline9RepairConnectivity({
    srj: input.srj,
    routes: input.routes,
    connMap,
  })
  const after = new FindClearancePathSolver({
    ...input,
    ...prepared,
    srj: { ...prepared.srj, traces: undefined },
  })
  after.solve()
  expect(after.failed).toBe(false)
  const path = after.getOutput()
  expect(path).not.toBeNull()
  expect(path![0]).toMatchObject(input.start)
  expect(path!.at(-1)).toMatchObject(input.end)
  expect(input).toEqual(original)
  expect(connMap.netMap).toEqual(netMap)
  const viewbox = { minX: -3.8, maxX: -1.3, minY: 3.4, maxY: 5.3 }
  for (const [name, points] of [
    ["before", input.existingPath!],
    ["after", path!],
  ] as const) {
    const route = { ...input.routes[input.routeIndex], route: points }
    const traces = input.routes.map((existing, index) => ({
      type: "pcb_trace" as const,
      pcb_trace_id: `route_${index}`,
      connection_name: existing.connectionName,
      route: convertHdRouteToSimplifiedRoute(
        index === input.routeIndex ? route : existing,
        input.srj.layerCount,
        { defaultViaHoleDiameter: input.viaHoleDiameter },
      ),
    }))
    const graphics = convertSrjToGraphicsObject({
      ...input.srj,
      connections: [],
      obstacles: input.srj.obstacles.filter((obstacle) =>
        obstacle.layers.includes("top"),
      ),
      traces,
    })
    graphics.points = []
    graphics.lines = graphics.lines.filter((line) => line.layer === "z0")
    graphics.circles ??= []
    graphics.circles.push({
      center: input.end,
      radius: 0.13,
      fill: "none",
      stroke: name === "before" ? "#dc2626" : "#15803d",
    })
    await expect(
      renderRvboyRoutingView(
        graphics,
        viewbox,
        name === "before"
          ? "Shared ground pad rejected before search"
          : "Declared ground aliases allow the pad connection",
        name === "before"
          ? "Exact RVboy input: no path, zero nodes explored"
          : `Same geometry: path found after ${after.stats.nodesPopped} explored nodes`,
      ),
    ).toMatchSvgSnapshot(import.meta.path, { svgName: name })
  }
})
