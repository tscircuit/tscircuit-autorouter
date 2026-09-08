import type {
  PadJunctionPoint,
  JunctionPath,
  SearchDirection,
  SearchCost,
  SearchState,
  TargetPad,
} from "./padJunctionGeometry"
import { simplifyJunctionPath } from "./padJunctionGeometry"

type SearchGoal =
  | { kind: "anchor"; point: PadJunctionPoint }
  | { kind: "pad" }

export type SearchResult =
  | { status: "searching" }
  | { status: "found"; path: JunctionPath }
  | { status: "no_path" }

/**
 * Anchor A                   Junction                    Anchor B
 * (-4, 4)                     (0, 4)                     (4, 4)
 *    o <------------------------o--------------------------> o
 *           first trunk         |         second trunk
 *                               |
 *                               | pad stem
 *                               v
 *                       +---------------+
 *                       |  .---------.  |
 *                       |  |    o    |  |  Target pad
 *                       |  |  entry  |  |
 *                       |  '---------'  |
 *                       +---------------+
 *
 * Each search starts at the junction. Its goal is Anchor A, Anchor B, or
 * anywhere inside the inset pad rectangle (the inner box). The inset is half
 * the trace width so the full trace fits inside the pad. Both anchors and the
 * pad geometry are supplied to all three searches to construct their grids.
 * Initial directions in this example: west, east, and south, respectively.
 */
type SearchInput = {
  start: PadJunctionPoint
  goal: SearchGoal
  anchors: [PadJunctionPoint, PadJunctionPoint]
  pad: TargetPad
  width: number
  gridStep: number
  direction: SearchDirection
  segmentIsClear: (start: PadJunctionPoint, end: PadJunctionPoint) => boolean
}
type FrontierEntry = SearchState & {
  estimate: SearchCost
  xIndex: number
  yIndex: number
  predecessor: FrontierEntry | null
}
const EPSILON = 1e-7
type GridDirection = {
  direction: SearchDirection
  opposite: SearchDirection
  xOffset: number
  yOffset: number
}
const DIRECTIONS: ReadonlyArray<GridDirection> = [
  { direction: "east", opposite: "west", xOffset: 1, yOffset: 0 },
  { direction: "north", opposite: "south", xOffset: 0, yOffset: 1 },
  { direction: "west", opposite: "east", xOffset: -1, yOffset: 0 },
  { direction: "south", opposite: "north", xOffset: 0, yOffset: -1 },
]

/** One frontier expansion per step. Costs are lexicographic, never weighted.
 * The heuristic adds zero bends and straight-line distance to the anchor/pad.
 * Both are lower bounds on the remaining orthogonal path, so popping a goal
 * minimizes bends, then length, for this arm on this finite grid. Other arms
 * already placed by the parent remain fixed during this search.
 */
export class PadJunctionSearch {
  result: SearchResult = { status: "searching" }
  readonly expandedPoints: PadJunctionPoint[] = []
  private readonly frontier: FrontierEntry[] = []
  private readonly bestCosts = new Map<string, SearchCost>()
  private readonly xCoordinates: number[]
  private readonly yCoordinates: number[]

  constructor(private readonly input: SearchInput) {
    const padding = Math.max(input.pad.width, input.pad.height, input.gridStep * 4)
    this.xCoordinates = this.createCoordinates("x", padding)
    this.yCoordinates = this.createCoordinates("y", padding)
    const xIndex = this.xCoordinates.indexOf(input.start.x)
    const yIndex = this.yCoordinates.indexOf(input.start.y)
    if (xIndex < 0 || yIndex < 0) throw new Error("PadJunctionSearch: start missing from grid")
    const key = `${xIndex},${yIndex},${input.direction}`
    const start: FrontierEntry = {
      point: input.start,
      direction: input.direction,
      cost: { bends: 0, length: 0 },
      estimate: { bends: 0, length: this.distanceToGoal(input.start) },
      key, xIndex, yIndex, predecessor: null,
    }
    this.bestCosts.set(key, start.cost)
    this.push(start)
  }

  private createCoordinates(axis: "x" | "y", padding: number): number[] {
    const { input } = this
    const halfSize = (axis === "x" ? input.pad.width : input.pad.height) / 2 - input.width / 2
    const exact = [
      input.start[axis], input.anchors[0][axis], input.anchors[1][axis],
      input.pad.center[axis],
      input.pad.center[axis] - halfSize,
      input.pad.center[axis] + halfSize,
    ]
    const minimum = Math.min(...exact) - padding
    const maximum = Math.max(...exact) + padding
    for (let coordinate = minimum; coordinate <= maximum; coordinate += input.gridStep) exact.push(coordinate)
    return [...new Set(exact)].sort((a, b) => a - b).filter((value, index, values): boolean => {
      const previous = values[index - 1]
      return previous === undefined || value - previous > EPSILON ||
        value === input.start[axis] || value === input.anchors[0][axis] ||
        value === input.anchors[1][axis]
    })
  }

  private distanceToGoal(point: PadJunctionPoint): number {
    const goal = this.input.goal
    if (goal.kind === "anchor") return Math.hypot(point.x - goal.point.x, point.y - goal.point.y)
    const halfWidth = this.input.pad.width / 2 - this.input.width / 2
    const halfHeight = this.input.pad.height / 2 - this.input.width / 2
    const dx = Math.max(0, Math.abs(point.x - this.input.pad.center.x) - halfWidth)
    const dy = Math.max(0, Math.abs(point.y - this.input.pad.center.y) - halfHeight)
    return Math.hypot(dx, dy)
  }

  private precedes(first: FrontierEntry, second: FrontierEntry): boolean {
    if (first.estimate.bends !== second.estimate.bends) return first.estimate.bends < second.estimate.bends
    if (first.estimate.length !== second.estimate.length) return first.estimate.length < second.estimate.length
    if (first.cost.length !== second.cost.length) return first.cost.length > second.cost.length
    return first.key < second.key
  }

  private getFrontierEntryOrThrow(index: number): FrontierEntry {
    const entry = this.frontier[index]
    if (!entry) {
      throw new Error(`PadJunctionSearch: missing frontier entry at index ${index}`)
    }
    return entry
  }

  private push(entry: FrontierEntry): void {
    this.frontier.push(entry)
    let index = this.frontier.length - 1
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2)
      const parent = this.getFrontierEntryOrThrow(parentIndex)
      if (!this.precedes(entry, parent)) break
      this.frontier[index] = parent
      index = parentIndex
    }
    this.frontier[index] = entry
  }

  private pop(): FrontierEntry | null {
    const last = this.frontier.pop()
    if (!last) return null
    const first = this.frontier[0]
    if (!first) return last
    let index = 0
    while (index * 2 + 1 < this.frontier.length) {
      let child = index * 2 + 1
      let childEntry = this.getFrontierEntryOrThrow(child)
      const rightChild = this.frontier[child + 1]
      if (rightChild && this.precedes(rightChild, childEntry)) {
        child++
        childEntry = rightChild
      }
      if (!this.precedes(childEntry, last)) break
      this.frontier[index] = childEntry
      index = child
    }
    this.frontier[index] = last
    return first
  }

  step(): void {
    if (this.result.status !== "searching") return
    const current = this.pop()
    if (!current) {
      this.result = { status: "no_path" }
      return
    }
    if (this.bestCosts.get(current.key) !== current.cost) return
    this.expandedPoints.push(current.point)
    if (this.distanceToGoal(current.point) < EPSILON) {
      const points: PadJunctionPoint[] = []
      let state: FrontierEntry | null = current
      while (state !== null) {
        points.push(state.point)
        state = state.predecessor
      }
      const path = simplifyJunctionPath(points.reverse())
      if (path.length === 0) throw new Error("PadJunctionSearch: reached goal without a path")
      this.result = { status: "found", path }
      return
    }
    for (const { direction, opposite, xOffset, yOffset } of DIRECTIONS) {
      if (current.cost.length === 0 && direction !== this.input.direction) continue
      if (opposite === current.direction) continue
      const xIndex = current.xIndex + xOffset
      const yIndex = current.yIndex + yOffset
      if (xIndex < 0 || yIndex < 0 || xIndex >= this.xCoordinates.length || yIndex >= this.yCoordinates.length) continue
      const x = this.xCoordinates[xIndex]
      const y = this.yCoordinates[yIndex]
      if (x === undefined || y === undefined) throw new Error("PadJunctionSearch: neighbor missing from grid")
      const point = { x, y, z: current.point.z }
      if (!this.input.segmentIsClear(current.point, point)) continue
      const key = `${xIndex},${yIndex},${direction}`
      const cost = {
        bends: current.cost.bends + Number(direction !== current.direction),
        length: current.cost.length + Math.hypot(
          point.x - current.point.x, point.y - current.point.y,
        ),
      }
      const previous = this.bestCosts.get(key)
      const alreadyCheaper = previous && (previous.bends < cost.bends ||
        (previous.bends === cost.bends && previous.length <= cost.length))
      if (alreadyCheaper) continue
      const state: FrontierEntry = {
        point, direction, cost,
        estimate: {
          bends: cost.bends,
          length: cost.length + this.distanceToGoal(point),
        },
        key, xIndex, yIndex, predecessor: current,
      }
      this.bestCosts.set(key, cost)
      this.push(state)
    }
  }

  get frontierPoints(): PadJunctionPoint[] {
    const points: PadJunctionPoint[] = []
    for (const state of this.frontier) {
      if (this.bestCosts.get(state.key) === state.cost) points.push(state.point)
    }
    return points
  }
}
