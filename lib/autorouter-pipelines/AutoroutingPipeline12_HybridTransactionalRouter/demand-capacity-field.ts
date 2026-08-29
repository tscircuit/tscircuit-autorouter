import { boundsIntersect, getPrimitiveBounds } from "./exact-geometry"
import type {
  DemandCapacityCell,
  DemandCapacityFieldSnapshot,
  GlobalTopologyPlan,
} from "./planning-types"
import type { TypedRoutingProblem } from "./types"
import type {
  HybridCopperPrimitive,
  HybridCopperSnapshot,
  HybridTransactionDelta,
} from "./transactional-copper-types"

type MutableDemandCapacityCell = {
  layer: string
  column: number
  row: number
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
  capacity: number
  demand: number
  committedCopperDemand: number
  obstaclePressure: number
  directionPenalty: number
}

export class DemandCapacityField {
  private readonly problem: TypedRoutingProblem
  private readonly topologyPlan: GlobalTopologyPlan
  private readonly cellSizeMm: number
  private readonly columnCount: number
  private readonly rowCount: number
  private readonly cells: MutableDemandCapacityCell[]
  private version: number

  constructor({
    problem,
    topologyPlan,
    copperSnapshot,
    maximumCellCount,
  }: {
    problem: TypedRoutingProblem
    topologyPlan: GlobalTopologyPlan
    copperSnapshot: HybridCopperSnapshot
    maximumCellCount: number
  }) {
    if (!Number.isSafeInteger(maximumCellCount) || maximumCellCount <= 0) {
      throw new Error("maximumCellCount must be a positive safe integer")
    }
    this.problem = problem
    this.topologyPlan = topologyPlan
    const board = problem.compiledRules.boardBounds
    const boardWidth = board.maxX - board.minX
    const boardHeight = board.maxY - board.minY
    const minimumCellSize = Math.max(
      problem.compiledRules.routingResolutionMm * 8,
      problem.compiledRules.viaPadDiameterMm +
        2 * problem.compiledRules.clearances.viaToTraceEdgeMm,
    )
    const boundedGrid = getBoundedGrid({
      boardWidth,
      boardHeight,
      minimumCellSize,
      layerCount: problem.compiledRules.layerStack.length,
      maximumCellCount,
    })
    this.cellSizeMm = boundedGrid.cellSizeMm
    this.columnCount = boundedGrid.columnCount
    this.rowCount = boundedGrid.rowCount
    this.version = copperSnapshot.version
    this.cells = []
    const primitives: readonly HybridCopperPrimitive[] = [
      ...copperSnapshot.segments,
      ...copperSnapshot.vias,
    ]
    for (const layer of problem.compiledRules.layerStack) {
      for (let row = 0; row < this.rowCount; row++) {
        for (let column = 0; column < this.columnCount; column++) {
          const bounds = {
            minX: board.minX + column * this.cellSizeMm,
            maxX: Math.min(
              board.maxX,
              board.minX + (column + 1) * this.cellSizeMm,
            ),
            minY: board.minY + row * this.cellSizeMm,
            maxY: Math.min(
              board.maxY,
              board.minY + (row + 1) * this.cellSizeMm,
            ),
          }
          const obstaclePressure = problem.compiledRules.obstacles.filter(
            (obstacle) =>
              obstacle.layers.includes(layer.name) &&
              boundsIntersect({
                first: bounds,
                second: {
                  minX: obstacle.center.x - obstacle.width / 2,
                  maxX: obstacle.center.x + obstacle.width / 2,
                  minY: obstacle.center.y - obstacle.height / 2,
                  maxY: obstacle.center.y + obstacle.height / 2,
                },
              }),
          ).length
          const demand = topologyPlan.routeObjectPlans.reduce(
            (total, routePlan) =>
              total +
              routePlan.corridors.filter(
                (corridor) =>
                  corridor.preferredLayer === layer.name &&
                  boundsIntersect({ first: bounds, second: corridor.bounds }),
              ).length,
            0,
          )
          const committedCopperDemand = countPrimitivesInCell({
            primitives,
            layerName: layer.name,
            bounds,
            problem,
          })
          const cellArea =
            (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY)
          const routingPitch =
            problem.compiledRules.routingResolutionMm +
            problem.compiledRules.clearances.traceToTraceMm
          this.cells.push({
            layer: layer.name,
            column,
            row,
            bounds,
            capacity: Math.max(
              0,
              Math.floor(cellArea / (routingPitch * routingPitch)) -
                obstaclePressure,
            ),
            demand,
            committedCopperDemand,
            obstaclePressure,
            directionPenalty: layer.preferredDirection === "any" ? 0 : 0.15,
          })
        }
      }
    }
  }

  getSnapshot(): DemandCapacityFieldSnapshot {
    return Object.freeze({
      version: this.version,
      cellSizeMm: this.cellSizeMm,
      columnCount: this.columnCount,
      rowCount: this.rowCount,
      cells: Object.freeze(
        this.cells.map((cell): DemandCapacityCell =>
          Object.freeze({
            ...cell,
            bounds: Object.freeze({ ...cell.bounds }),
          }),
        ),
      ),
    })
  }

  applyCommittedTransaction({
    delta,
    committedSnapshot,
  }: {
    delta: HybridTransactionDelta
    committedSnapshot: HybridCopperSnapshot
  }): void {
    if (committedSnapshot.version !== this.version + 1) {
      throw new Error(
        `demand field version must advance by one from ${this.version}, received ${committedSnapshot.version}`,
      )
    }
    const primitives: readonly HybridCopperPrimitive[] = [
      ...committedSnapshot.segments,
      ...committedSnapshot.vias,
    ]
    for (const cell of this.cells) {
      if (!boundsIntersect({ first: cell.bounds, second: delta.affectedBounds })) {
        continue
      }
      cell.committedCopperDemand = countPrimitivesInCell({
        primitives,
        layerName: cell.layer,
        bounds: cell.bounds,
        problem: this.problem,
      })
    }
    this.version = committedSnapshot.version
  }
}

function getBoundedGrid({
  boardWidth,
  boardHeight,
  minimumCellSize,
  layerCount,
  maximumCellCount,
}: {
  boardWidth: number
  boardHeight: number
  minimumCellSize: number
  layerCount: number
  maximumCellCount: number
}): {
  cellSizeMm: number
  columnCount: number
  rowCount: number
} {
  if (maximumCellCount < layerCount) {
    throw new Error(
      `maximumCellCount ${maximumCellCount} cannot represent ${layerCount} layers`,
    )
  }
  let cellSizeMm = minimumCellSize
  for (let refinement = 0; refinement < 32; refinement++) {
    const columnCount = Math.max(1, Math.ceil(boardWidth / cellSizeMm))
    const rowCount = Math.max(1, Math.ceil(boardHeight / cellSizeMm))
    const totalCellCount = columnCount * rowCount * layerCount
    if (totalCellCount <= maximumCellCount) {
      return { cellSizeMm, columnCount, rowCount }
    }
    cellSizeMm *= Math.sqrt(totalCellCount / maximumCellCount) * 1.01
  }
  return {
    cellSizeMm: Math.max(boardWidth, boardHeight),
    columnCount: 1,
    rowCount: 1,
  }
}

function countPrimitivesInCell({
  primitives,
  layerName,
  bounds,
  problem,
}: {
  primitives: readonly HybridCopperPrimitive[]
  layerName: string
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
  problem: TypedRoutingProblem
}): number {
  return primitives.filter(
    (primitive) =>
      primitiveTouchesLayer({ primitive, layerName, problem }) &&
      boundsIntersect({ first: bounds, second: getPrimitiveBounds(primitive) }),
  ).length
}

function primitiveTouchesLayer({
  primitive,
  layerName,
  problem,
}: {
  primitive: HybridCopperPrimitive
  layerName: string
  problem: TypedRoutingProblem
}): boolean {
  if (primitive.kind === "segment") return primitive.layer === layerName
  const startIndex = problem.compiledRules.layerStack.findIndex(
    (layer) => layer.name === primitive.fromLayer,
  )
  const endIndex = problem.compiledRules.layerStack.findIndex(
    (layer) => layer.name === primitive.toLayer,
  )
  const layerIndex = problem.compiledRules.layerStack.findIndex(
    (layer) => layer.name === layerName,
  )
  return (
    layerIndex >= Math.min(startIndex, endIndex) &&
    layerIndex <= Math.max(startIndex, endIndex)
  )
}
