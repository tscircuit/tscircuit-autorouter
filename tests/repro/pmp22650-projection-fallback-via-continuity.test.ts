import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject, type GraphicsObject } from "graphics-debug"
import { canonicalizePipeline9HdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/canonicalizePipeline9HdRoutes"
import { Pipeline9ClearanceProjectionSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9ClearanceProjectionSolver"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

const port = {
  x: 154.42259946,
  y: 55.25607693999999,
}

const originalSrj: SimpleRouteJson = {
  layerCount: 8,
  minTraceWidth: 0.254,
  minViaDiameter: 0.762,
  bounds: { minX: 149, maxX: 159, minY: 50, maxY: 60 },
  obstacles: [
    {
      type: "rect",
      center: port,
      width: 0.9144,
      height: 1.778,
      ccwRotationDegrees: 90,
      layers: [
        "top",
        "inner1",
        "inner2",
        "inner3",
        "inner4",
        "inner5",
        "inner6",
        "bottom",
      ],
      connectedTo: [
        "pcb_plated_hole_altium_6192",
        "source_net_altium_pcb_385",
        "source_trace_altium_pcb_385",
      ],
      circuitJsonMetadata: {
        pcb_plated_hole_id: "pcb_plated_hole_altium_6192",
        pcb_port_id: "pcb_port_altium_6192",
        source_component_name: "J34",
        source_port_name: "5",
      },
    },
  ],
  connections: [
    {
      name: "source_net_altium_pcb_385",
      pointsToConnect: [
        {
          ...port,
          layer: "top",
          pointId: "pcb_port_altium_6192",
          pcb_port_id: "pcb_port_altium_6192",
          port_selector: "J34.5",
        },
      ],
    },
  ],
}

const routes: HighDensityRoute[] = [
  {
    connectionName: "source_net_altium_pcb_385",
    traceThickness: 0.254,
    viaDiameter: 0.762,
    route: [
      { x: 154.423, y: 55.256, z: 3 },
      { ...port, z: 0, pcb_port_id: "pcb_port_altium_6192" },
    ],
    vias: [port],
  },
]

const renderTransition = (route: HighDensityRoute): string => {
  const graphics: GraphicsObject = {
    coordinateSystem: "cartesian",
    title: "PMP22650 J34.5 projection fallback · 1 µm view",
    rects: [
      {
        center: {
          x: (route.route[0]!.x + route.route.at(-1)!.x) / 2,
          y: (route.route[0]!.y + route.route.at(-1)!.y) / 2,
        },
        width: 0.001,
        height: 0.001,
        fill: "#0d111700",
        stroke: "#334155",
        label: "1 µm diagnostic viewport",
      },
    ],
    points: route.route.map((point, index) => ({
      x: point.x,
      y: point.y,
      color: point.z === 0 ? "#f472b6" : "#38bdf8",
      label: `${index}: z${point.z} (${point.x}, ${point.y})`,
    })),
    lines: route.route.slice(1).map((point, index) => {
      const previous = route.route[index]!
      const isLayerTransition = previous.z !== point.z
      const isDisplacedLayerTransition =
        isLayerTransition && (previous.x !== point.x || previous.y !== point.y)
      return {
        points: [previous, point],
        strokeColor: isDisplacedLayerTransition
          ? "#ef4444"
          : isLayerTransition
            ? "#a855f7"
            : "#22c55e",
        strokeWidth: 0.00003,
        label: isDisplacedLayerTransition
          ? "layer transition endpoints differ"
          : isLayerTransition
            ? "co-located layer transition"
            : `z${point.z} planar lead`,
      }
    }),
    circles: route.route.slice(1).flatMap((point, index) => {
      const previous = route.route[index]!
      return previous.z !== point.z &&
        previous.x === point.x &&
        previous.y === point.y
        ? [
            {
              center: point,
              radius: 0.00008,
              fill: "#a855f7",
              label: "co-located via transition",
            },
          ]
        : []
    }),
  }
  return getSvgFromGraphicsObject(graphics, {
    backgroundColor: "#0d1117",
    svgWidth: 900,
    svgHeight: 600,
  })
}

test("PMP22650 projection fallback preserves exact J34.5 via continuity", async () => {
  const solver = new Pipeline9ClearanceProjectionSolver({
    originalSrj,
    routes,
    previousRoutes: canonicalizePipeline9HdRoutes(routes),
    drcEvaluator: () => [
      {
        type: "pcb_trace_error",
        message: "Unresolved PMP22650 regional DRC error",
      },
    ],
  })
  solver.solve()

  expect(solver.failed).toBe(false)
  const outputRoute = solver.getOutput()[0]!
  expect(
    outputRoute.route.filter((point, index) => {
      const previous = outputRoute.route[index - 1]
      return (
        previous !== undefined &&
        previous.z !== point.z &&
        (previous.x !== point.x || previous.y !== point.y)
      )
    }),
  ).toHaveLength(0)
  expect(outputRoute.route).toEqual([
    routes[0]!.route[0],
    { ...port, z: 3 },
    routes[0]!.route[1],
  ])
  await expect(renderTransition(outputRoute)).toMatchSvgSnapshot(
    import.meta.path,
  )
})
