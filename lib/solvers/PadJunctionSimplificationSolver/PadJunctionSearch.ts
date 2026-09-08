import type {
  PadJunctionPoint,
  SearchCost,
  SearchState,
  TargetPad,
} from "./PadJunctionSimplificationSolver"
import { simplifyJunctionPath } from "./PadJunctionSimplificationSolver"

type SearchInput = {
  start: PadJunctionPoint
  anchor: PadJunctionPoint | null
  anchors: [PadJunctionPoint, PadJunctionPoint]
  pad: TargetPad
  width: number
  gridStep: number
  direction: number
  segmentIsClear: (start: PadJunctionPoint, end: PadJunctionPoint) => boolean
}
type FrontierEntry = SearchState & {
  estimate: SearchCost
  xIndex: number
  yIndex: number
}
const EPSILON = 1e-7
const DIRECTIONS = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const

/** One frontier expansion per step. Costs are lexicographic, never weighted.
 * The heuristic adds zero bends and straight-line distance to the anchor/pad.
 * Both are lower bounds on the remaining orthogonal path, so popping a goal
 * minimizes bends, then length, for this arm on this finite grid. Other arms
 * already placed by the parent remain fixed during this search.
 */
export class PadJunctionSearch {
  finished = false
  path: PadJunctionPoint[] | null = null
  readonly expandedPoints: PadJunctionPoint[] = []
  private readonly frontier: FrontierEntry[] = []
  private readonly bestCosts = new Map<string, SearchCost>()
  private readonly predecessors = new Map<string, string>()
  private readonly states = new Map<string, FrontierEntry>()
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
      key, xIndex, yIndex,
    }
    this.bestCosts.set(key, start.cost)
    this.states.set(key, start)
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
    return [...new Set(exact)].sort((a, b) => a - b).filter((value, index, values) =>
      index === 0 || value - values[index - 1] > EPSILON ||
      value === input.start[axis] || value === input.anchors[0][axis] ||
      value === input.anchors[1][axis],
    )
  }

  private distanceToGoal(point: PadJunctionPoint): number {
    if (this.input.anchor) return Math.hypot(point.x - this.input.anchor.x, point.y - this.input.anchor.y)
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

  private push(entry: FrontierEntry): void {
    this.frontier.push(entry)
    let index = this.frontier.length - 1
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2)
      if (!this.precedes(entry, this.frontier[parentIndex])) break
      this.frontier[index] = this.frontier[parentIndex]
      index = parentIndex
    }
    this.frontier[index] = entry
  }

  private pop(): FrontierEntry | null {
    if (this.frontier.length === 0) return null
    const first = this.frontier[0]
    const last = this.frontier.pop()!
    if (this.frontier.length === 0) return first
    let index = 0
    while (index * 2 + 1 < this.frontier.length) {
      let child = index * 2 + 1
      if (child + 1 < this.frontier.length && this.precedes(this.frontier[child + 1], this.frontier[child])) child++
      if (!this.precedes(this.frontier[child], last)) break
      this.frontier[index] = this.frontier[child]
      index = child
    }
    this.frontier[index] = last
    return first
  }

  step(): void {
    if (this.finished) return
    const current = this.pop()
    if (!current) {
      this.finished = true
      return
    }
    if (this.bestCosts.get(current.key) !== current.cost) return
    this.expandedPoints.push(current.point)
    if (this.distanceToGoal(current.point) < EPSILON) {
      const points: PadJunctionPoint[] = []
      let key: string | undefined = current.key
      while (key !== undefined) {
        const state = this.states.get(key)
        if (!state) throw new Error(`PadJunctionSearch: missing predecessor state ${key}`)
        points.push(state.point)
        key = this.predecessors.get(key)
      }
      this.path = simplifyJunctionPath(points.reverse())
      this.finished = true
      return
    }
    for (let direction = 0; direction < DIRECTIONS.length; direction++) {
      if (current.cost.length === 0 && direction !== this.input.direction) continue
      if ((direction + 2) % 4 === current.direction) continue
      const xIndex = current.xIndex + DIRECTIONS[direction][0]
      const yIndex = current.yIndex + DIRECTIONS[direction][1]
      if (xIndex < 0 || yIndex < 0 || xIndex >= this.xCoordinates.length || yIndex >= this.yCoordinates.length) continue
      const point = { x: this.xCoordinates[xIndex], y: this.yCoordinates[yIndex], z: current.point.z }
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
        key, xIndex, yIndex,
      }
      this.bestCosts.set(key, cost)
      this.predecessors.set(key, current.key)
      this.states.set(key, state)
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
