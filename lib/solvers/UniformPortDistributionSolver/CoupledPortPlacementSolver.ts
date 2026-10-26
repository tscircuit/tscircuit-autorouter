import { BaseSolver } from "@tscircuit/solver-utils"
import {
  subtractEdgeIntervals,
  type EdgeInterval,
} from "./getSharedEdgePhysicalIntervals"

export type CoupledPortPlacementVariable = {
  id: string
  x: number
  y: number
  dx: number
  dy: number
  domains: EdgeInterval[]
  preferred: number
}
export type CoupledPortPlacementConstraint = {
  first: number
  second: number
  gap: number
}
export type CoupledPortPlacementInput = {
  variables: CoupledPortPlacementVariable[]
  orderConstraints: CoupledPortPlacementConstraint[]
  distanceConstraints: CoupledPortPlacementConstraint[]
  solutionValidator?: (positions: readonly number[]) => boolean
}
type SearchBox = EdgeInterval[][]

/** Move one floating-point value outward without deleting closed-domain ends. */
function adjacentFloat(value: number, upward: boolean): number {
  if (!Number.isFinite(value)) return value
  if (value === 0) return upward ? Number.MIN_VALUE : -Number.MIN_VALUE
  const view = new DataView(new ArrayBuffer(8))
  view.setFloat64(0, value)
  const bits = view.getBigUint64(0)
  view.setBigUint64(0, bits + (value > 0 === upward ? 1n : -1n))
  return view.getFloat64(0)
}

/** Search exact one-dimensional port domains without changing any event IDs. */
export class CoupledPortPlacementSolver extends BaseSolver {
  private readonly input: CoupledPortPlacementInput
  private readonly incoming: CoupledPortPlacementConstraint[][]
  private readonly outgoing: CoupledPortPlacementConstraint[][]
  private readonly distances: CoupledPortPlacementConstraint[][]
  private readonly order: number[]
  private readonly pending: SearchBox[]
  private positions?: number[]

  constructor(input: CoupledPortPlacementInput) {
    super()
    const ids = new Set<string>()
    this.input = {
      ...input,
      variables: input.variables.map((variable) => {
        if (
          ids.has(variable.id) ||
          ![
            variable.x,
            variable.y,
            variable.dx,
            variable.dy,
            variable.preferred,
          ].every(Number.isFinite) ||
          !(
            (Math.abs(variable.dx) === 1 && variable.dy === 0) ||
            (Math.abs(variable.dy) === 1 && variable.dx === 0) ||
            (variable.dx === 0 && variable.dy === 0)
          )
        )
          throw new Error("Invalid coupled port identity or axis")
        ids.add(variable.id)
        const sorted = variable.domains
          .map(([low, high]): EdgeInterval => {
            if (
              ![low, high].every(Number.isFinite) ||
              low > high ||
              (variable.dx === 0 &&
                variable.dy === 0 &&
                (low !== 0 || high !== 0))
            )
              throw new Error("Invalid coupled port domain")
            return [low, high]
          })
          .sort((first, second) => first[0] - second[0] || first[1] - second[1])
        const domains: EdgeInterval[] = []
        for (const [low, high] of sorted) {
          const previous = domains.at(-1)
          if (previous && low <= previous[1])
            previous[1] = Math.max(previous[1], high)
          else domains.push([low, high])
        }
        return { ...variable, domains }
      }),
      orderConstraints: input.orderConstraints.map((constraint) => ({
        ...constraint,
      })),
      distanceConstraints: input.distanceConstraints.map((constraint) => ({
        ...constraint,
      })),
    }
    const count = input.variables.length
    this.incoming = Array.from({ length: count }, () => [])
    this.outgoing = Array.from({ length: count }, () => [])
    this.distances = Array.from({ length: count }, () => [])
    for (const constraint of [
      ...this.input.orderConstraints,
      ...this.input.distanceConstraints,
    ]) {
      if (
        ![constraint.first, constraint.second].every(
          (index) => Number.isInteger(index) && index >= 0 && index < count,
        ) ||
        constraint.first === constraint.second ||
        !Number.isFinite(constraint.gap) ||
        constraint.gap < 0
      )
        throw new Error("Invalid coupled port constraint")
    }
    for (const constraint of this.input.orderConstraints) {
      this.incoming[constraint.second]!.push(constraint)
      this.outgoing[constraint.first]!.push(constraint)
    }
    for (const constraint of this.input.distanceConstraints) {
      this.distances[constraint.first]!.push(constraint)
      this.distances[constraint.second]!.push(constraint)
    }
    const indegree = this.incoming.map((constraints) => constraints.length)
    this.order = indegree.flatMap((degree, index) =>
      degree === 0 ? [index] : [],
    )
    for (let next = 0; next < this.order.length; next++) {
      for (const constraint of this.outgoing[this.order[next]!]!) {
        indegree[constraint.second]!--
        if (indegree[constraint.second] === 0)
          this.order.push(constraint.second)
      }
    }
    if (this.order.length !== count)
      throw new Error("Coupled face-order constraints contain a cycle")
    this.pending = [this.input.variables.map((variable) => variable.domains)]
    this.stats.boxesExamined = 0
    this.stats.precisionLimitedBoxes = 0
    this.stats.rejectedCandidates = 0
  }

  private numericGuard(first: number, second: number, gap: number): number {
    const a = this.input.variables[first]!,
      b = this.input.variables[second]!
    return (
      128 *
      Number.EPSILON *
      Math.max(
        1,
        Math.abs(a.x),
        Math.abs(a.y),
        Math.abs(b.x),
        Math.abs(b.y),
        gap,
        ...a.domains.flatMap((interval) => interval.map(Math.abs)),
        ...b.domains.flatMap((interval) => interval.map(Math.abs)),
      )
    )
  }

  private clip(
    domains: EdgeInterval[],
    low: number,
    high: number,
  ): EdgeInterval[] {
    const output: EdgeInterval[] = []
    for (const [start, end] of domains) {
      const first = Math.max(start, low),
        last = Math.min(end, high)
      if (first <= last) output.push([first, last])
    }
    return output
  }

  private point(index: number, position: number): { x: number; y: number } {
    const variable = this.input.variables[index]!
    return {
      x: variable.x + variable.dx * position,
      y: variable.y + variable.dy * position,
    }
  }

  private forbiddenByPoint(index: number, point: { x: number; y: number }, radius: number): EdgeInterval | undefined {
    const variable = this.input.variables[index]!
    if (variable.dx === 0 && variable.dy === 0)
      return Math.hypot(variable.x - point.x, variable.y - point.y) < radius
        ? [-Infinity, Infinity] : undefined
    const normal = variable.dx === 0 ? Math.abs(variable.x - point.x) : Math.abs(variable.y - point.y)
    if (normal >= radius) return undefined
    const center = (point.x - variable.x) * variable.dx + (point.y - variable.y) * variable.dy
    const reach = Math.sqrt(Math.max(0, radius * radius - normal * normal))
    return [center - reach, center + reach]
  }

  /** Axis-aligned scalar domains attain their farthest pair at outer ends. */
  private maximumDistance(box: SearchBox, first: number, second: number): number {
    let maximum = 0
    for (const a of [box[first]![0]![0], box[first]!.at(-1)![1]]) {
      for (const b of [box[second]![0]![0], box[second]!.at(-1)![1]]) {
        const p = this.point(first, a), q = this.point(second, b)
        const distance = Math.hypot(p.x - q.x, p.y - q.y)
        if (!Number.isFinite(distance)) return Infinity
        maximum = Math.max(maximum, distance)
      }
    }
    return maximum
  }

  private contractDistance(box: SearchBox, first: number, second: number, gap: number): void {
    const peer = box[second]!
    if (peer.length === 0 || box[first]!.length === 0) return
    const radius = gap - this.numericGuard(first, second, gap)
    if (radius <= 0) return
    const low = this.forbiddenByPoint(first, this.point(second, peer[0]![0]), radius)
    const high = this.forbiddenByPoint(first, this.point(second, peer.at(-1)![1]), radius)
    if (!low || !high) return
    // Squared distance is convex in the peer scalar. Only points within BOTH
    // endpoint discs are impossible for every choice in its whole domain.
    const start = Math.max(low[0], high[0]), end = Math.min(low[1], high[1])
    if (start < end) box[first] = subtractEdgeIntervals(box[first]!, [[start, end]])
  }

  private contractOrder(box: SearchBox): boolean {
    for (let offset = this.order.length - 1; offset >= 0; offset--) {
      const first = this.order[offset]!
      if (box[first]!.length === 0) return false
      for (const constraint of this.outgoing[first]!) {
        const peer = box[constraint.second]!
        if (peer.length === 0) return false
        // Use the exact final subtraction before outward-safe bound clipping.
        // A clipping guard cannot make an impossible closed order feasible.
        if (peer.at(-1)![1] - box[first]![0]![0] < constraint.gap) return false
        const upper = peer.at(-1)![1] - constraint.gap + this.numericGuard(first, constraint.second, constraint.gap)
        box[first] = this.clip(box[first]!, -Infinity, upper)
      }
    }
    for (const first of this.order) {
      if (box[first]!.length === 0) return false
      for (const constraint of this.outgoing[first]!) {
        const lower = box[first]![0]![0] + constraint.gap - this.numericGuard(first, constraint.second, constraint.gap)
        box[constraint.second] = this.clip(box[constraint.second]!, lower, Infinity)
      }
    }
    return box.every((domain) => domain.length > 0)
  }

  private select(domains: EdgeInterval[], preferred: number, low: number, high: number): number | undefined {
    let selected: number | undefined, bestDistance = Infinity
    for (const [start, end] of domains) {
      const first = Math.max(start, low), last = Math.min(end, high)
      if (first > last) continue
      const value = Math.min(last, Math.max(first, preferred)), distance = Math.abs(value - preferred)
      if (selected === undefined || distance < bestDistance) {
        selected = value
        bestDistance = distance
      }
    }
    return selected
  }

  private candidate(box: SearchBox, mode: "preferred" | "separated" | "interior" | "earliest" | "latest"): number[] | undefined {
    const positions = new Array<number>(box.length)
    const order = mode === "latest" ? [...this.order].reverse() : this.order
    for (const index of order) {
      const domain = box[index]!
      let choices = domain
      if (mode === "separated") {
        // These conditional exclusions construct ONE candidate, never contract
        // the search box. Other candidates and branches retain every solution.
        for (const constraint of this.distances[index]!) {
          const peer = constraint.first === index ? constraint.second : constraint.first
          if (!Number.isFinite(positions[peer])) continue
          const blocked = this.forbiddenByPoint(index, this.point(peer, positions[peer]!),
            constraint.gap + this.numericGuard(index, peer, constraint.gap))
          if (blocked) choices = subtractEdgeIntervals(choices, [blocked])
        }
      }
      let low = domain[0]![0], high = domain.at(-1)![1]
      for (const constraint of mode === "latest" ? this.outgoing[index]! : this.incoming[index]!) {
        if (mode === "latest") {
          const peer = positions[constraint.second]!
          let bound = peer - constraint.gap
          if (peer - bound < constraint.gap) bound = adjacentFloat(bound, false)
          high = Math.min(high, bound)
        } else {
          const peer = positions[constraint.first]!
          let bound = peer + constraint.gap
          if (bound - peer < constraint.gap) bound = adjacentFloat(bound, true)
          low = Math.max(low, bound)
        }
      }
      const preferred = mode === "earliest" ? domain[0]![0]
        : mode === "latest" ? domain.at(-1)![1]
          : mode === "interior" || mode === "separated" ? domain[0]![0] + (domain.at(-1)![1] - domain[0]![0]) / 2
            : this.input.variables[index]!.preferred
      const value = this.select(choices, preferred, low, high)
      if (value === undefined) return undefined
      positions[index] = value
    }
    return positions
  }

  private firstViolation(positions: number[]): CoupledPortPlacementConstraint | undefined {
    for (const constraint of this.input.orderConstraints) {
      if (positions[constraint.second]! - positions[constraint.first]! < constraint.gap) return constraint
    }
    for (const constraint of this.input.distanceConstraints) {
      const first = this.point(constraint.first, positions[constraint.first]!)
      const second = this.point(constraint.second, positions[constraint.second]!)
      if (Math.hypot(first.x - second.x, first.y - second.y) < constraint.gap) return constraint
    }
    return undefined
  }

  private examineBox(): void {
    const box = this.pending.pop()
    if (!box) {
      this.failed = true
      this.error = "UNRESOLVED coupled port placement: no accepted domain box remains"
      this.stats.unresolvedReason = this.stats.precisionLimitedBoxes > 0 ? "numerical precision" : "search exhausted"
      return
    }
    this.stats.boxesExamined++
    if (!this.contractOrder(box)) return
    for (const { first, second, gap } of this.input.distanceConstraints) {
      if (this.maximumDistance(box, first, second) < gap) return
      this.contractDistance(box, first, second, gap)
      this.contractDistance(box, second, first, gap)
      if (box[first]!.length === 0 || box[second]!.length === 0) return
    }
    if (!this.contractOrder(box)) return
    let violation: CoupledPortPlacementConstraint | undefined
    for (const mode of ["preferred", "separated", "interior", "earliest", "latest"] as const) {
      const positions = this.candidate(box, mode)
      if (!positions) continue
      const failed = this.firstViolation(positions)
      violation ??= failed
      if (failed) continue
      if (this.input.solutionValidator && !this.input.solutionValidator(positions)) {
        this.stats.rejectedCandidates++
        continue
      }
      this.positions = positions
      this.solved = true
      return
    }
    const choices = violation ? [violation.first, violation.second] : this.order
    const index = [...choices].sort((a, b) =>
      (box[b]!.at(-1)![1] - box[b]![0]![0]) - (box[a]!.at(-1)![1] - box[a]![0]![0]) || a - b,
    )[0]
    if (index === undefined) return
    const domains = box[index]!, preferred = this.input.variables[index]!.preferred
    let branches: EdgeInterval[][]
    if (domains.length > 1) {
      let closest = 0
      for (let offset = 1; offset < domains.length; offset++) {
        const distance = (interval: EdgeInterval): number => Math.abs(Math.max(interval[0], Math.min(interval[1], preferred)) - preferred)
        if (distance(domains[offset]!) < distance(domains[closest]!)) closest = offset
      }
      branches = [[domains[closest]!], domains.filter((_, offset) => offset !== closest)]
    } else {
      const [low, high] = domains[0]!, middle = low + (high - low) / 2
      if (!(middle > low && middle < high)) {
        this.stats.precisionLimitedBoxes++
        return
      }
      branches = [[[low, middle]], [[middle, high]]]
      if (preferred > middle) branches.reverse()
    }
    for (const branch of [...branches].reverse()) {
      const child = box.map((domain, offset) => offset === index ? branch : domain)
      this.pending.push(child)
    }
  }

  override _step(): void {
    this.examineBox()
    if (!this.solved && !this.failed && this.iterations >= this.MAX_ITERATIONS) {
      this.stats.unresolvedReason = "phase budget exhausted"
      // BaseSolver would overwrite a plain failed/error result at this limit.
      // Throw after the final permitted box, preserving its budget and status.
      throw new Error("UNRESOLVED coupled port placement: phase budget exhausted")
    }
  }

  override getOutput(): number[] {
    if (!this.solved || !this.positions)
      throw new Error(this.error ?? "UNRESOLVED coupled port placement")
    return [...this.positions]
  }
}
