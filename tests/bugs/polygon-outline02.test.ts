import { describe, expect, test } from "bun:test"
import { CapacityMeshSolver } from "lib"
import type { SimpleRouteJson } from "lib/types"
import { doesSegmentCrossPolygonBoundary } from "lib/utils/polygonContainment"

const simpleRouteJson: SimpleRouteJson = {
  bounds: {
    minX: -9,
    maxX: 9,
    minY: -7,
    maxY: 7,
  },
  obstacles: [
    {
      type: "rect",
      layers: ["top"],
      center: {
        x: -5.51,
        y: -4,
      },
      width: 0.54,
      height: 0.64,
      connectedTo: [
        "pcb_smtpad_0",
        "connectivity_net11",
        "source_port_0",
        "pcb_smtpad_0",
        "pcb_port_0",
      ],
      __zLayers: [0],
    },
    {
      type: "rect",
      layers: ["top"],
      center: {
        x: -4.49,
        y: -4,
      },
      width: 0.54,
      height: 0.64,
      connectedTo: [
        "pcb_smtpad_1",
        "connectivity_net0",
        "source_trace_0",
        "source_port_1",
        "source_port_3",
        "pcb_smtpad_1",
        "pcb_port_1",
        "pcb_smtpad_3",
        "pcb_port_3",
      ],
      __zLayers: [0],
    },
    {
      type: "rect",
      layers: ["top"],
      center: {
        x: 4.49,
        y: -4,
      },
      width: 0.54,
      height: 0.64,
      connectedTo: [
        "pcb_smtpad_2",
        "connectivity_net12",
        "source_port_2",
        "pcb_smtpad_2",
        "pcb_port_2",
      ],
      __zLayers: [0],
    },
    {
      type: "rect",
      layers: ["top"],
      center: {
        x: 5.51,
        y: -4,
      },
      width: 0.54,
      height: 0.64,
      connectedTo: [
        "pcb_smtpad_3",
        "connectivity_net0",
        "source_trace_0",
        "source_port_1",
        "source_port_3",
        "pcb_smtpad_1",
        "pcb_port_1",
        "pcb_smtpad_3",
        "pcb_port_3",
      ],
      __zLayers: [0],
    },
  ],
  connections: [
    {
      name: "source_trace_0",
      pointsToConnect: [
        {
          x: -4.49,
          y: -4,
          layer: "top",
          pointId: "pcb_port_1",
          pcb_port_id: "pcb_port_1",
        },
        {
          x: 5.51,
          y: -4,
          layer: "top",
          pointId: "pcb_port_3",
          pcb_port_id: "pcb_port_3",
        },
      ],
    },
  ],
  layerCount: 2,
  minTraceWidth: 0.15,
  outline: [
    {
      x: -8,
      y: -6,
    },
    {
      x: -2,
      y: -6,
    },
    {
      x: -2,
      y: 2,
    },
    {
      x: 2,
      y: 2,
    },
    {
      x: 2,
      y: -6,
    },
    {
      x: 8,
      y: -6,
    },
    {
      x: 8,
      y: 6,
    },
    {
      x: -8,
      y: 6,
    },
  ],
}

describe.skip("polygon outline path simplification", () => {
  test("simplified traces stay within the outline", () => {
    const solver = new CapacityMeshSolver(simpleRouteJson)
    solver.solve()

    expect(solver.failed).toBeFalse()
    expect(solver.solved).toBeTrue()

    const simplifiedTraces = solver.getOutputSimplifiedPcbTraces()

    for (const trace of simplifiedTraces) {
      // Filter to only wire and via segments that have direct x/y coordinates
      const pointSegments = trace.route.filter(
        (s): s is Extract<typeof s, { x: number; y: number }> =>
          s.route_type === "wire" || s.route_type === "via",
      )

      for (let i = 0; i < pointSegments.length - 1; i++) {
        const start = pointSegments[i]
        const end = pointSegments[i + 1]

        const crossesOutline = doesSegmentCrossPolygonBoundary({
          start: { x: start.x, y: start.y },
          end: { x: end.x, y: end.y },
          polygon: simpleRouteJson.outline!,
        })

        expect(crossesOutline).toBeFalse()
      }
    }
  })
})
