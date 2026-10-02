import type { SimpleRouteJson } from "lib/types"
import { boardFixture } from "./fixtures"

/** Public point-terminal controls with three signal endpoints and one fixed net. */
export function createComparisonBoard(
  offset = 0,
  width = 0.3,
): SimpleRouteJson {
  const srj = boardFixture(offset, width).srj
  srj.minTraceWidth = width
  srj.obstacles = []
  srj.bounds.maxY = 15
  srj.connections[0]!.pointsToConnect.push({
    x: offset + 5,
    y: 10,
    layer: "top",
    pointId: "e",
  })
  for (const connection of srj.connections)
    for (const point of connection.pointsToConnect)
      point.pcb_port_id = point.pointId
  return srj
}
