import { BaseSolver } from "@tscircuit/solver-utils"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { OwnerPairKey, PortPointWithOwnerPair, SharedEdge } from "./types"

type Constraint = {
  terms: Array<{ index: number; coefficient: number }>
  minimum: number
  normSquared: number
  multiplier: number
  label: string
}
type Anchor = {
  port: PortPointWithOwnerPair
  edge: SharedEdge
  axis: "x" | "y"
  variableIndex?: number
}
type Input = {
  edges: Map<OwnerPairKey, SharedEdge>
  portsByEdge: Map<OwnerPairKey, PortPointWithOwnerPair[]>
  originalPositionsByPortId: ReadonlyMap<string, { x: number; y: number }>
  boundsByPortId: Map<string, { min: number; max: number }>
  connMap: ConnectivityMap
  separation: number
}

/** Jointly positions boundary anchors; a neighboring movable port is not fixed. */
export class UniformPortClearanceSolver extends BaseSolver {
  private values: number[] = []
  private constraints: Constraint[] = []
  private anchors = new Map<string, Anchor>()

  constructor(private input: Input) {
    super()
    this.MAX_ITERATIONS = 20_000
    const anchorsByNode = new Map<string, Anchor[]>()
    for (const [key, edge] of input.edges) {
      for (const port of input.portsByEdge.get(key) ?? []) {
        const id = port.portPointId!
        if (this.anchors.has(id)) continue
        const bounds = input.boundsByPortId.get(id)
        if (!bounds)
          throw new Error(`Missing port clearance bounds for "${id}"`)
        const axis = edge.orientation === "vertical" ? "y" : "x"
        const anchor: Anchor = { port, edge, axis }
        if (bounds.max - bounds.min > 1e-10) {
          const index = this.values.length
          anchor.variableIndex = index
          this.values.push(port[axis])
          this.addConstraint(
            [{ index, coefficient: 1 }],
            bounds.min,
            `${id}: minimum`,
          )
          this.addConstraint(
            [{ index, coefficient: -1 }],
            -bounds.max,
            `${id}: maximum`,
          )
        }
        this.anchors.set(id, anchor)
        for (const nodeId of edge.ownerNodeIds) {
          const neighbors = anchorsByNode.get(nodeId) ?? []
          neighbors.push(anchor)
          anchorsByNode.set(nodeId, neighbors)
        }
      }
    }
    const pairs = new Set<string>()
    for (const anchors of anchorsByNode.values()) {
      for (let i = 0; i < anchors.length; i++) {
        const first = anchors[i]!
        for (const second of anchors.slice(i + 1)) {
          if (
            first.port.z !== second.port.z ||
            first.port.connectionName === second.port.connectionName ||
            input.connMap.areIdsConnected(
              first.port.connectionName,
              second.port.connectionName,
            )
          )
            continue
          const ids = [first.port.portPointId!, second.port.portPointId!].sort()
          const key = JSON.stringify(ids)
          if (pairs.has(key)) continue
          pairs.add(key)
          this.addSeparationConstraint(first, second)
        }
      }
    }
  }

  private addConstraint(
    terms: Constraint["terms"],
    minimum: number,
    label: string,
  ): void {
    const normSquared = terms.reduce(
      (sum, term) => sum + term.coefficient ** 2,
      0,
    )
    if (normSquared < 1e-20) {
      if (minimum > 1e-8)
        throw new Error(`Fixed port clearance conflict: ${label}`)
      return
    }
    this.constraints.push({ terms, minimum, normSquared, multiplier: 0, label })
  }

  private addSeparationConstraint(first: Anchor, second: Anchor): void {
    const firstOriginal = this.input.originalPositionsByPortId.get(
      first.port.portPointId!,
    )
    const secondOriginal = this.input.originalPositionsByPortId.get(
      second.port.portPointId!,
    )
    if (!firstOriginal || !secondOriginal)
      throw new Error("Missing original port position for clearance constraint")
    let dx = second.port.x - first.port.x
    let dy = second.port.y - first.port.y
    // If uniform spacing aligns opposite-edge ports, their separation normal
    // has no movable component. Use the planner's ordering to break that tie;
    // an already separated pair should keep its preferred normal instead.
    const hasMovableProjection = [first, second].some(
      (anchor) =>
        anchor.variableIndex !== undefined &&
        Math.abs(anchor.axis === "x" ? dx : dy) > 1e-10,
    )
    if (!hasMovableProjection && Math.hypot(dx, dy) < this.input.separation) {
      dx = secondOriginal.x - firstOriginal.x
      dy = secondOriginal.y - firstOriginal.y
    }
    if (Math.hypot(dx, dy) < 1e-10) {
      dx = second.edge.center.x - first.edge.center.x
      dy = second.edge.center.y - first.edge.center.y
    }
    const movableAnchor = [first, second].find(
      (anchor) => anchor.variableIndex !== undefined,
    )
    if (
      movableAnchor &&
      Math.hypot(dx, dy) < this.input.separation &&
      [first, second].every(
        (anchor) =>
          anchor.variableIndex === undefined ||
          Math.abs(anchor.axis === "x" ? dx : dy) < 1e-10,
      )
    ) {
      // Opposite-edge ports can be aligned in both the planner and uniform
      // output. Their current normal is perpendicular to every movable axis;
      // it is not evidence that the ports are fixed. Build the separating
      // normal from the required offset along their actual edge instead.
      const axis = movableAnchor.axis
      const perpendicularDistance = axis === "x" ? dy : dx
      const offset = Math.sqrt(
        this.input.separation ** 2 - perpendicularDistance ** 2,
      )
      const intervals = [first, second].map((anchor) =>
        anchor.variableIndex !== undefined && anchor.axis === axis
          ? this.input.boundsByPortId.get(anchor.port.portPointId!)!
          : { min: anchor.port[axis], max: anchor.port[axis] },
      )
      const positiveRoom = intervals[1]!.max - intervals[0]!.min
      const negativeRoom = intervals[0]!.max - intervals[1]!.min
      if (Math.max(positiveRoom, negativeRoom) < offset)
        throw new Error("Insufficient edge length to separate aligned ports")
      const direction = positiveRoom >= offset ? 1 : -1
      if (axis === "x") dx = direction * offset
      else dy = direction * offset
    }
    const distance = Math.hypot(dx, dy)
    if (distance < 1e-10) {
      throw new Error(
        `Coincident foreign port anchors: ${first.port.portPointId}, ${second.port.portPointId}`,
      )
    }
    const nx = dx / distance,
      ny = dy / distance
    const terms: Constraint["terms"] = []
    let constant = 0
    for (const [anchor, sign] of [
      [first, -1],
      [second, 1],
    ] as const) {
      const coefficient = sign * (anchor.axis === "x" ? nx : ny)
      if (anchor.variableIndex !== undefined) {
        terms.push({ index: anchor.variableIndex, coefficient })
        constant +=
          sign * (anchor.axis === "x" ? ny * anchor.port.y : nx * anchor.port.x)
      } else {
        constant += sign * (nx * anchor.port.x + ny * anchor.port.y)
      }
    }
    // A separating half-plane preserves the ports' established relative side
    // and guarantees Euclidean clearance while both edge coordinates can move.
    this.addConstraint(
      terms,
      // Keep a numerical cushion for movable projections, but an immutable
      // separation exactly at the requested physical clearance is valid.
      this.input.separation +
        (terms.some((term) => Math.abs(term.coefficient) > 1e-10) ? 1e-6 : 0) -
        constant,
      `${first.port.portPointId} / ${second.port.portPointId}`,
    )
  }

  override _step(): void {
    // Hildreth's dual projection minimizes squared displacement subject to all
    // box and separation constraints. Dual corrections let earlier ports move
    // again instead of permanently consuming a neighboring narrow edge's space.
    for (const constraint of this.constraints) {
      const value = constraint.terms.reduce(
        (sum, term) => sum + term.coefficient * this.values[term.index]!,
        0,
      )
      const change = Math.max(
        -constraint.multiplier,
        (constraint.minimum - value) / constraint.normSquared,
      )
      constraint.multiplier += change
      for (const term of constraint.terms)
        this.values[term.index]! += change * term.coefficient
    }
    let maximumViolation = 0
    let worstConstraint = ""
    for (const constraint of this.constraints) {
      const value = constraint.terms.reduce(
        (sum, term) => sum + term.coefficient * this.values[term.index]!,
        0,
      )
      const violation = constraint.minimum - value
      if (violation > maximumViolation) {
        maximumViolation = violation
        worstConstraint = constraint.label
      }
    }
    this.stats = {
      variables: this.values.length,
      constraints: this.constraints.length,
      maximumViolation,
      worstConstraint,
    }
    if (maximumViolation <= 1e-8) this.solved = true
    else if (this.iterations >= this.MAX_ITERATIONS - 1) {
      throw new Error(
        `Port clearance constraints did not converge: ${worstConstraint}, violation ${maximumViolation}`,
      )
    }
  }

  getOutput(): Map<OwnerPairKey, PortPointWithOwnerPair[]> {
    if (!this.solved)
      throw new Error("Port clearance output requested before convergence")
    return new Map(
      [...this.input.portsByEdge].map(([key, ports]) => [
        key,
        ports.map((port) => {
          const anchor = this.anchors.get(port.portPointId!)
          if (anchor?.variableIndex === undefined) return port
          return { ...port, [anchor.axis]: this.values[anchor.variableIndex] }
        }),
      ]),
    )
  }
}
