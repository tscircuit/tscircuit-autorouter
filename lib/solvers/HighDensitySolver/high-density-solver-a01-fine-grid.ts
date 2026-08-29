import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

type HighDensitySolverA01FineGridParams = Omit<
  ConstructorParameters<typeof HighDensitySolverA01>[0],
  "cellSizeMm" | "traceMargin"
>

const FINE_GRID_CELL_SIZE_MM = 0.05
const FINE_GRID_TRACE_MARGIN_MM = 0.15
const MINIMUM_PAIR_COUNT = 4
const MAXIMUM_GRID_STATE_COUNT = 2_000

export class HighDensitySolverA01FineGrid extends HighDensitySolverA01 {
  override getSolverName(): string {
    return "HighDensitySolverA01FineGrid"
  }

  static isApplicable(nodeWithPortPoints: NodeWithPortPoints): boolean {
    const pairCount = nodeWithPortPoints.portPointsInPairs?.length ?? 0
    const terminalLayerCount = new Set(
      nodeWithPortPoints.portPoints.map((portPoint) => portPoint.z),
    ).size
    const layerCount =
      nodeWithPortPoints.availableZ?.length ?? terminalLayerCount
    const rows = Math.floor(
      nodeWithPortPoints.height / FINE_GRID_CELL_SIZE_MM,
    )
    const cols = Math.floor(
      nodeWithPortPoints.width / FINE_GRID_CELL_SIZE_MM,
    )
    const stateCount = rows * cols * layerCount

    return (
      pairCount >= MINIMUM_PAIR_COUNT &&
      terminalLayerCount === 1 &&
      layerCount > 0 &&
      nodeWithPortPoints.portPoints.every((portPoint) =>
        nodeWithPortPoints.availableZ?.includes(portPoint.z) ?? true,
      ) &&
      rows > 0 &&
      cols > 0 &&
      stateCount <= MAXIMUM_GRID_STATE_COUNT
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
