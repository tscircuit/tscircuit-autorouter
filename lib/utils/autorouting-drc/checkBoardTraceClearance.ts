import { type Point, segmentToSegmentMinDistance } from "@tscircuit/math-utils"
import type { AnyCircuitElement, PcbBoard } from "circuit-json"

type BoardEdge = { start: Point; end: Point }
type BoardTraceClearanceOptions = { board?: PcbBoard; margin?: number }

const edgesByBoard = new WeakMap<PcbBoard, BoardEdge[]>()

/** Scores copper distance from the board boundary using the reference margin. */
export const checkBoardTraceClearance = (
  circuitJson: AnyCircuitElement[],
  options: BoardTraceClearanceOptions = {},
): Record<string, unknown>[] => {
  const board =
    options.board ?? circuitJson.find((element) => element.type === "pcb_board")
  if (!board) return []
  let edges = edgesByBoard.get(board)
  if (!edges) {
    let points: Point[]
    if (board.outline?.length) {
      points = board.outline
    } else if (
      board.center &&
      typeof board.width === "number" &&
      typeof board.height === "number"
    ) {
      points = [
        {
          x: board.center.x - board.width / 2,
          y: board.center.y - board.height / 2,
        },
        {
          x: board.center.x + board.width / 2,
          y: board.center.y - board.height / 2,
        },
        {
          x: board.center.x + board.width / 2,
          y: board.center.y + board.height / 2,
        },
        {
          x: board.center.x - board.width / 2,
          y: board.center.y + board.height / 2,
        },
      ]
    } else {
      return []
    }
    edges = points.map((start, index) => ({
      start,
      end: points[(index + 1) % points.length]!,
    }))
    edgesByBoard.set(board, edges)
  }
  const margin = options.margin ?? board.min_board_edge_clearance ?? 0.2
  const errors: Record<string, unknown>[] = []
  for (const trace of circuitJson) {
    if (trace.type !== "pcb_trace") continue
    for (let index = 0; index < trace.route.length - 1; index++) {
      const start = trace.route[index]!
      const end = trace.route[index + 1]!
      if (start.route_type !== "wire" || end.route_type !== "wire") continue
      const width = start.width ?? end.width ?? 0.1
      let minimumDistance = Number.POSITIVE_INFINITY
      for (const edge of edges) {
        minimumDistance = Math.min(
          minimumDistance,
          segmentToSegmentMinDistance(start, end, edge.start, edge.end),
        )
      }
      const requiredDistance = width / 2 + margin
      if (!(minimumDistance < requiredDistance)) continue
      errors.push({
        type: "pcb_trace_error",
        error_type: "pcb_trace_error",
        pcb_trace_error_id: `trace_too_close_to_board_${trace.pcb_trace_id}_segment_${index}`,
        message: `Trace too close to board edge (${minimumDistance.toFixed(3)}mm < ${requiredDistance.toFixed(3)}mm required, margin: ${margin}mm)`,
        pcb_trace_id: trace.pcb_trace_id,
        source_trace_id: trace.source_trace_id || "",
        center: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
        pcb_component_ids: [],
        pcb_port_ids: [],
      })
    }
  }
  return errors
}
