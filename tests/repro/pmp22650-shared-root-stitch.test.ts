import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { SimpleRouteConnection } from "lib/types"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import pmp22650SharedRootStitch from "./assets/pmp22650-shared-root-stitch.json"

const connections: SimpleRouteConnection[] =
  pmp22650SharedRootStitch.connections
const hdRoutes: HighDensityIntraNodeRoute[] = pmp22650SharedRootStitch.hdRoutes

test("PMP22650 shared-root path probing ignores sibling terminal metadata", () => {
  const solver = new MultipleHighDensityRouteStitchSolver3({
    connections,
    hdRoutes,
    layerCount: 8,
    preserveTerminalPcbPortIds: true,
    preferSameLayerTerminalEndpoints: true,
  })
  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)

  const stitchedRoutes = solver.mergedHdRoutes.filter(
    (route) => route.connectionName === "source_net_altium_pcb_385_mst171",
  )
  expect(
    new Set(
      stitchedRoutes
        .flatMap((route) => [route.startPcbPortId, route.endPcbPortId])
        .filter((pcbPortId) => pcbPortId !== undefined),
    ),
  ).toEqual(new Set(["pcb_port_altium_6346", "pcb_port_altium_6439"]))

  const svg = getSvgFromGraphicsObject(solver.visualize(), {
    backgroundColor: "#0d1117",
    svgWidth: 900,
    svgHeight: 600,
  })

  expect(svg).toMatchSvgSnapshot(import.meta.path)
})
