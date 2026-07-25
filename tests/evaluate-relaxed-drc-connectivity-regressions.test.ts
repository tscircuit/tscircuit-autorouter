import { expect, test } from "bun:test"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { Obstacle, SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

const makeTerminalObstacle = ({
  x,
  y = 0,
  portId,
  connectionName,
}: {
  x: number
  y?: number
  portId: string
  connectionName: string
}): Obstacle => ({
  type: "rect",
  layers: ["top"],
  center: { x, y },
  width: 0.2,
  height: 0.2,
  connectedTo: [connectionName, portId, `pcb_smtpad_${portId}`],
})

const getContinuityErrorIds = (
  result: ReturnType<typeof evaluateRelaxedDrc>,
): string[] =>
  result.errors.flatMap((error) => {
    if (!("pcb_trace_error_id" in error)) return []
    return error.pcb_trace_error_id.startsWith("missing_connection_") ||
      error.pcb_trace_error_id.startsWith("disconnected_endpoint_")
      ? [error.pcb_trace_error_id]
      : []
  })

test("relaxed DRC accepts a terminal contacted by the interior of combined same-net copper", () => {
  const connectionName = "shared"
  const fixedTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "fixed",
    connection_name: connectionName,
    route: [
      { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
    ],
  }
  const candidateTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "candidate",
    connection_name: `${connectionName}_mst0`,
    route: [
      { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: 2, y: 0, width: 0.1, layer: "top" },
    ],
  }
  const inputSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, minY: -1, maxX: 3, maxY: 1 },
    obstacles: [
      makeTerminalObstacle({
        x: -1,
        portId: "pcb_port_a",
        connectionName,
      }),
      makeTerminalObstacle({
        x: 0,
        portId: "pcb_port_b",
        connectionName,
      }),
      makeTerminalObstacle({
        x: 1,
        portId: "pcb_port_c",
        connectionName,
      }),
      makeTerminalObstacle({
        x: 2,
        portId: "pcb_port_d",
        connectionName,
      }),
    ],
    connections: [
      {
        name: connectionName,
        pointsToConnect: [
          { x: -1, y: 0, layer: "top", pcb_port_id: "pcb_port_a" },
          { x: 0, y: 0, layer: "top", pcb_port_id: "pcb_port_b" },
        ],
      },
    ],
    traces: [fixedTrace],
  }
  const srjWithPointPairs: SimpleRouteJson = {
    ...inputSrj,
    connections: [
      {
        name: `${connectionName}_mst0`,
        __rootConnectionNames: [connectionName],
        pointsToConnect: [
          { x: 1, y: 0, layer: "top", pcb_port_id: "pcb_port_c" },
          { x: 2, y: 0, layer: "top", pcb_port_id: "pcb_port_d" },
        ],
      },
    ],
  }

  const result = evaluateRelaxedDrc({
    inputSrj,
    srjWithPointPairs,
    traces: [candidateTrace],
  })

  expect(getContinuityErrorIds(result)).toEqual([])
})

test("relaxed DRC reports an entirely missing required point-pair route", () => {
  const connectionName = "net"
  const inputSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, minY: -1, maxX: 2, maxY: 1 },
    obstacles: [
      makeTerminalObstacle({
        x: -1,
        portId: "pcb_port_a",
        connectionName,
      }),
      makeTerminalObstacle({
        x: 1,
        portId: "pcb_port_b",
        connectionName,
      }),
    ],
    connections: [
      {
        name: connectionName,
        pointsToConnect: [
          { x: -1, y: 0, layer: "top", pcb_port_id: "pcb_port_a" },
          { x: 1, y: 0, layer: "top", pcb_port_id: "pcb_port_b" },
        ],
      },
    ],
    traces: [],
  }
  const srjWithPointPairs: SimpleRouteJson = {
    ...inputSrj,
    connections: [
      {
        name: `${connectionName}_mst0`,
        __rootConnectionNames: [connectionName],
        pointsToConnect: inputSrj.connections[0]!.pointsToConnect,
      },
    ],
  }

  const result = evaluateRelaxedDrc({
    inputSrj,
    srjWithPointPairs,
    traces: [],
  })

  expect(getContinuityErrorIds(result)).toContain(
    `missing_connection_combined_${connectionName}`,
  )
})

test("relaxed DRC reports a same-net candidate fragment disconnected from the routed net", () => {
  const connectionName = "net"
  const inputSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, minY: -1, maxX: 2, maxY: 2 },
    obstacles: [
      makeTerminalObstacle({
        x: -1,
        portId: "pcb_port_a",
        connectionName,
      }),
      makeTerminalObstacle({
        x: 1,
        portId: "pcb_port_b",
        connectionName,
      }),
    ],
    connections: [
      {
        name: connectionName,
        pointsToConnect: [
          { x: -1, y: 0, layer: "top", pcb_port_id: "pcb_port_a" },
          { x: 1, y: 0, layer: "top", pcb_port_id: "pcb_port_b" },
        ],
      },
    ],
    traces: [],
  }
  const srjWithPointPairs: SimpleRouteJson = {
    ...inputSrj,
    connections: [
      {
        name: `${connectionName}_mst0`,
        __rootConnectionNames: [connectionName],
        pointsToConnect: inputSrj.connections[0]!.pointsToConnect,
      },
    ],
  }
  const mainTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "main",
    connection_name: `${connectionName}_mst0`,
    route: [
      { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
    ],
  }
  const orphanTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "orphan",
    connection_name: `${connectionName}_mst0`,
    route: [
      { route_type: "wire", x: 0, y: 1, width: 0.1, layer: "top" },
      { route_type: "wire", x: 1, y: 1, width: 0.1, layer: "top" },
    ],
  }

  const result = evaluateRelaxedDrc({
    inputSrj,
    srjWithPointPairs,
    traces: [mainTrace, orphanTrace],
  })
  const orphanContinuityError = result.errors.find((error) => {
    if (
      !("pcb_trace_error_id" in error) ||
      (!error.pcb_trace_error_id.startsWith("missing_connection_") &&
        !error.pcb_trace_error_id.startsWith("disconnected_endpoint_"))
    ) {
      return false
    }
    const owners = (
      error as typeof error & { candidate_pcb_trace_ids?: string[] }
    ).candidate_pcb_trace_ids
    return owners?.includes(orphanTrace.pcb_trace_id) ?? false
  })

  expect(orphanContinuityError).toBeDefined()
})
