import { HighDensitySolverA13 } from "@tscircuit/high-density-a01"
import type { PortPoint } from "lib/types/high-density-types"

type A13Params = ConstructorParameters<typeof HighDensitySolverA13>[0]
const originalPortPoint = Symbol("originalPortPoint")
type InsetPortPoint = PortPoint & { [originalPortPoint]: PortPoint }

/** Keeps unrelated copper away from adjacent nodes while preserving terminals. */
export class HighDensitySolverA13WithBoundaryClearance extends HighDensitySolverA13 {
  constructor(props: A13Params) {
    const node = props.nodeWithPortPoints
    const inset = (props.traceThickness ?? 0.1) / 2 + (props.traceMargin ?? 0.1)
    const hasInterior = node.width > inset * 2 && node.height > inset * 2
    const minX = node.center.x - node.width / 2 + inset
    const maxX = node.center.x + node.width / 2 - inset
    const minY = node.center.y - node.height / 2 + inset
    const maxY = node.center.y + node.height / 2 - inset
    const portPoints: InsetPortPoint[] = node.portPoints.map((point) => ({
      ...point,
      x: Math.max(minX, Math.min(maxX, point.x)),
      y: Math.max(minY, Math.min(maxY, point.y)),
      [originalPortPoint]: point,
    }))
    const projectedTerminals = new Map<string, PortPoint>()
    let collapsedTerminals = false
    for (const point of portPoints) {
      const key = `${point.x},${point.y},${point.z}`
      const previous = projectedTerminals.get(key)
      const original = point[originalPortPoint]
      if (
        previous &&
        (previous.x !== original.x || previous.y !== original.y)
      ) {
        collapsedTerminals = true
      }
      projectedTerminals.set(key, original)
    }
    super({
      ...props,
      nodeWithPortPoints: hasInterior
        ? {
            ...node,
            width: node.width - inset * 2,
            height: node.height - inset * 2,
            portPoints,
          }
        : node,
    })
    if (collapsedTerminals) {
      this.failed = true
      this.error = "Boundary clearance collapses distinct terminals"
    }
    if (!hasInterior) {
      this.failed = true
      this.error = "Node has no interior after copper boundary clearance"
    }
  }

  override getOutput(): ReturnType<HighDensitySolverA13["getOutput"]> {
    return super.getOutput().map((route) => {
      const start = route.route[0] as InsetPortPoint
      const end = route.route[route.route.length - 1] as InsetPortPoint
      if (!start[originalPortPoint] || !end[originalPortPoint]) {
        throw new Error("A13 route lost its original terminal metadata")
      }
      return {
        ...route,
        route: [
          { ...start[originalPortPoint] },
          ...route.route,
          { ...end[originalPortPoint] },
        ],
      }
    })
  }
}
