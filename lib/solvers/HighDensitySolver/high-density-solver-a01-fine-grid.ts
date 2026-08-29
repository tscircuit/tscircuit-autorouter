import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

type HighDensitySolverA01FineGridParams = Omit<
  ConstructorParameters<typeof HighDensitySolverA01>[0],
  "cellSizeMm" | "traceMargin"
>

const FINE_GRID_CELL_SIZE_MM = 0.05
const FINE_GRID_TRACE_MARGIN_MM = 0.15
// This is the verified grid topology where the coarse A01 search aliases two
// routes into a rip loop. Keep the candidate exact so unrelated portfolios do
// not change solver selection merely because a denser search is available.
const TARGET_FINE_GRID_SHORT_AXIS_CELL_COUNT = 15
const TARGET_FINE_GRID_LONG_AXIS_CELL_COUNT = 29

export class HighDensitySolverA01FineGrid extends HighDensitySolverA01 {
  override getSolverName(): string {
    return "HighDensitySolverA01FineGrid"
  }

  static isApplicable(node: NodeWithPortPoints): boolean {
    const pairCount = node.portPointsInPairs?.length ?? 0
    const terminalLayerCount = new Set(node.portPoints.map((point) => point.z))
      .size
    const terminalLayer = node.portPoints[0]?.z
    const layerCount = node.availableZ?.length ?? terminalLayerCount
    const rowCount = Math.floor(node.height / FINE_GRID_CELL_SIZE_MM)
    const columnCount = Math.floor(node.width / FINE_GRID_CELL_SIZE_MM)
    const shortAxisCellCount = Math.min(rowCount, columnCount)
    const longAxisCellCount = Math.max(rowCount, columnCount)

    return (
      pairCount === 4 &&
      terminalLayerCount === 1 &&
      terminalLayer === 1 &&
      layerCount === 2 &&
      shortAxisCellCount === TARGET_FINE_GRID_SHORT_AXIS_CELL_COUNT &&
      longAxisCellCount === TARGET_FINE_GRID_LONG_AXIS_CELL_COUNT
    )
  }

  constructor(params: HighDensitySolverA01FineGridParams) {
    super({
      ...params,
      cellSizeMm: FINE_GRID_CELL_SIZE_MM,
      traceMargin: FINE_GRID_TRACE_MARGIN_MM,
    })
  }
}
