import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { SimpleRouteConnection } from "lib/types"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import pmp22650SharedRootStitch from "./assets/pmp22650-shared-root-stitch.json"

const connections: SimpleRouteConnection[] =
  pmp22650SharedRootStitch.connections
const hdRoutes: HighDensityIntraNodeRoute[] =
  pmp22650SharedRootStitch.hdRoutes

test("PMP22650 shared-root path probing rejects a sibling terminal", () => {
  expect(
    () =>
      new MultipleHighDensityRouteStitchSolver3({
        connections,
        hdRoutes,
        layerCount: 8,
        preserveTerminalPcbPortIds: true,
        preferSameLayerTerminalEndpoints: true,
      }),
  ).toThrow(
    'found unknown PCB terminal "pcb_port_altium_6969" on "source_net_altium_pcb_385_mst171"',
  )

  const svg = getSvgFromGraphicsObject(
    {
      title: "PMP22650 shared-root path rejected before stitching",
      lines: hdRoutes.map((hdRoute) => ({
        points: hdRoute.route,
        strokeColor:
          hdRoute.connectionName === "source_net_altium_pcb_385_mst171"
            ? "#2563eb"
            : "#f97316",
        strokeWidth: hdRoute.traceThickness,
        label: hdRoute.connectionName,
      })),
      points: connections.flatMap((connection) =>
        connection.pointsToConnect.map((point) => ({
          ...point,
          color:
            connection.name === "source_net_altium_pcb_385_mst171"
              ? "#2563eb"
              : "#f97316",
          label: point.pcb_port_id,
        })),
      ),
    },
    {
      backgroundColor: "#0d1117",
      svgWidth: 900,
      svgHeight: 600,
    },
  )

  expect(svg).toMatchSvgSnapshot(import.meta.path)
})
