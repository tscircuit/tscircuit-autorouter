import { expect, test } from "bun:test"
import { applyPipeline9TerminalEscapeRelocations } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9TerminalEscapeRelocations"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("terminal relocation stays in physical rotated copper instead of its routing envelope", (): void => {
  const terminal: Obstacle = {
    type: "rect",
    layers: ["top"],
    center: { x: 0, y: 0 },
    width: 0.25,
    height: 0.875,
    ccwRotationDegrees: 225,
    connectedTo: ["pcb_smtpad_11", "pcb_port_9"],
  }
  const conflicting: Obstacle = {
    type: "rect",
    layers: ["top"],
    center: { x: 0.353553, y: 0.353554 },
    width: 0.25,
    height: 0.875,
    ccwRotationDegrees: 225,
    connectedTo: ["pcb_smtpad_10"],
  }
  const originalSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
    obstacles: [terminal, conflicting],
    connections: [
      {
        name: "terminal_connection",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pcb_port_id: "pcb_port_9" },
          { x: -0.35, y: 1.2, layer: "top" },
        ],
      },
    ],
  }
  const routingSrj: SimpleRouteJson = {
    ...originalSrj,
    obstacles: [
      {
        ...terminal,
        ccwRotationDegrees: undefined,
        center: { x: -0.198873782208716, y: 0.1104854345603983 },
        width: 0.39774756441743264,
        height: 0.5745242597140696,
      },
      conflicting,
    ],
  }
  const routes: HighDensityRoute[] = [
    {
      connectionName: "terminal_connection",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -0.35, y: 1.2, z: 0 },
        { x: -0.35, y: 1.15, z: 0 },
        { x: 0, y: 0, z: 0, pcb_port_id: "pcb_port_9" },
      ],
      vias: [],
    },
  ]
  const candidateEndpoints: Array<{ x: number; y: number }> = []
  const result = applyPipeline9TerminalEscapeRelocations({
    srj: routingSrj,
    originalSrj,
    routes,
    newConnections: originalSrj.connections,
    syntheticConnectionNames: new Set(),
    drcEvaluator: ({ hdRoutes }) => {
      const endpoint = hdRoutes![0]!.route.at(-1)!
      if (endpoint.x !== 0 || endpoint.y !== 0) {
        candidateEndpoints.push(endpoint)
      }
      return [
        {
          type: "pcb_pad_trace_clearance_error",
          pcb_trace_id: "terminal_connection_0",
          pcb_pad_id: "pcb_smtpad_10",
          minimum_clearance: 0.1,
          actual_clearance: 0,
        },
      ]
    },
  })

  expect(result.attemptedCandidateCount).toBeGreaterThan(0)
  expect(candidateEndpoints.length).toBe(result.attemptedCandidateCount)
  const inverseRotation = (-225 * Math.PI) / 180
  for (const endpoint of candidateEndpoints) {
    const localX =
      endpoint.x * Math.cos(inverseRotation) -
      endpoint.y * Math.sin(inverseRotation)
    const localY =
      endpoint.x * Math.sin(inverseRotation) +
      endpoint.y * Math.cos(inverseRotation)
    expect(Math.abs(localX) + 0.05).toBeLessThanOrEqual(terminal.width / 2)
    expect(Math.abs(localY) + 0.05).toBeLessThanOrEqual(terminal.height / 2)
  }
  expect(routes[0]!.route.at(-1)).toEqual({
    x: 0,
    y: 0,
    z: 0,
    pcb_port_id: "pcb_port_9",
  })
})
