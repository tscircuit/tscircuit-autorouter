import { expect, test } from "bun:test"
import { applyPipeline9TerminalEscapeRelocations } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9TerminalEscapeRelocations"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("terminal relocation shares its evaluation budget across independent contacts", (): void => {
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
  // Repeat the same unresolved contact at disjoint translated locations.
  // A per-error search would multiply expensive whole-board DRC evaluations.
  const repeatedSrj: SimpleRouteJson = {
    ...originalSrj,
    bounds: { minX: -3, maxX: 100, minY: -3, maxY: 3 },
    obstacles: [],
    connections: [],
  }
  const repeatedRoutes: HighDensityRoute[] = []
  const errors: Array<Record<string, unknown>> = []
  for (let index = 0; index < 20; index++) {
    const xOffset = index * 5
    const portId = `contact_${index}_port`
    const obstacleId = `pcb_smtpad_conflict_${index}`
    const connectionName = `contact_${index}`
    repeatedSrj.obstacles.push(
      {
        ...terminal,
        center: { x: xOffset, y: 0 },
        connectedTo: [`pcb_smtpad_terminal_${index}`, portId],
      },
      {
        ...conflicting,
        obstacleId,
        center: { x: conflicting.center.x + xOffset, y: conflicting.center.y },
        connectedTo: [obstacleId],
      },
    )
    repeatedSrj.connections.push({
      name: connectionName,
      pointsToConnect: originalSrj.connections[0]!.pointsToConnect.map(
        (point) => ({
          ...point,
          x: point.x + xOffset,
          ...(point.pcb_port_id ? { pcb_port_id: portId } : {}),
        }),
      ),
    })
    repeatedRoutes.push({
      ...routes[0]!,
      connectionName,
      route: routes[0]!.route.map((point) => ({
        ...point,
        x: point.x + xOffset,
        ...(point.pcb_port_id ? { pcb_port_id: portId } : {}),
      })),
    })
    errors.push({
      type: "pcb_pad_trace_clearance_error",
      pcb_trace_id: `${connectionName}_0`,
      pcb_pad_id: obstacleId,
      minimum_clearance: 0.1,
      actual_clearance: 0,
    })
  }
  let evaluationCount = 0
  const result = applyPipeline9TerminalEscapeRelocations({
    srj: repeatedSrj,
    originalSrj: repeatedSrj,
    routes: repeatedRoutes,
    newConnections: repeatedSrj.connections,
    syntheticConnectionNames: new Set(),
    drcEvaluator: () => {
      evaluationCount++
      return errors
    },
  })

  expect(result.attemptedCandidateCount).toBe(256)
  expect(evaluationCount).toBe(257)
  expect(result.routes).toBe(repeatedRoutes)
  expect(result.acceptedCandidateCount).toBe(0)
})
