import type { GraphicsObject } from "graphics-debug"
import type { CapacityMeshNodeId } from "lib/types"
import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import { BaseSolver } from "../BaseSolver"
import { computeNodePf as computeAssignedNodePf } from "../MultiSectionPortPointOptimizer/computeSectionScore"
import type {
  ConnectionPathResult,
  InputNodeWithPortPoints,
} from "./PortPointPathingSolver"
import { CapacityPathPlanner } from "./capacity-aware/CapacityPathPlanner"
import { buildCapacityInputNodes } from "./capacity-aware/buildCapacityInputNodes"
import { buildCapacityPathingOutput } from "./capacity-aware/buildCapacityPathingOutput"
import type { CapacityAwarePortPointPathingSolverParams } from "./capacity-aware/types"

const ROUTE_COLORS = ["#ef4444", "#2563eb", "#16a34a", "#9333ea", "#ea580c"]

/**
 * Routes nets through region/layer corridors before assigning exact edge lanes.
 * MultiSectionPortPointOptimizer subsequently resolves the detailed geometry
 * inside each region.
 */
export class CapacityAwarePortPointPathingSolver extends BaseSolver {
  private readonly planner: CapacityPathPlanner
  private nodesWithPortPoints: NodeWithPortPoints[] = []

  readonly inputNodeWithPortPoints: InputNodeWithPortPoints[]
  readonly connectionsWithResults: ConnectionPathResult[] = []
  readonly assignedPortPoints = new Map<
    string,
    { connectionName: string; rootConnectionName?: string }
  >()
  readonly nodeAssignedPortPoints = new Map<CapacityMeshNodeId, PortPoint[]>()

  constructor(
    private readonly params: CapacityAwarePortPointPathingSolverParams,
  ) {
    super()
    this.planner = new CapacityPathPlanner(params)
    this.MAX_ITERATIONS = this.planner.maxIterations

    const preloadedPorts = params.graph.ports.filter(
      (port) => (port.d._preloadedTracePortAssignments?.length ?? 0) > 0,
    )
    this.stats = {
      preloadedPortCount: preloadedPorts.length,
      preloadedFixedSegmentCount: preloadedPorts.reduce(
        (count, port) =>
          count + (port.d._preloadedTracePortAssignments?.length ?? 0),
        0,
      ),
    }

    this.inputNodeWithPortPoints = buildCapacityInputNodes(params)
  }

  override getSolverName(): string {
    return "CapacityAwarePortPointPathingSolver"
  }

  override _step() {
    this.planner.step()
    this.progress = this.planner.progress
    this.stats = { ...this.stats, ...this.planner.stats }

    if (this.planner.failed) {
      this.failed = true
      this.error = `${this.getSolverName()} ${this.planner.error}`
      return
    }
    if (!this.planner.solved) return

    const output = buildCapacityPathingOutput(
      this.params,
      this.planner.getPlan(),
    )
    this.nodesWithPortPoints = output.nodesWithPortPoints
    this.connectionsWithResults.push(...output.connectionsWithResults)
    for (const [portPointId, assignment] of output.assignedPortPoints) {
      this.assignedPortPoints.set(portPointId, assignment)
    }
    for (const [nodeId, portPoints] of output.nodeAssignedPortPoints) {
      this.nodeAssignedPortPoints.set(nodeId, portPoints)
    }
    this.solved = true
    this.progress = 1
  }

  getOutput(): {
    nodesWithPortPoints: NodeWithPortPoints[]
    inputNodeWithPortPoints: InputNodeWithPortPoints[]
  } {
    return {
      nodesWithPortPoints: this.nodesWithPortPoints,
      inputNodeWithPortPoints: this.inputNodeWithPortPoints,
    }
  }

  computeNodePf(node: InputNodeWithPortPoints): number | null {
    const solvedNode = this.nodesWithPortPoints.find(
      (candidate) => candidate.capacityMeshNodeId === node.capacityMeshNodeId,
    )
    const region = this.planner.regionById.get(node.capacityMeshNodeId)
    if (!solvedNode || !region) return null
    return computeAssignedNodePf(solvedNode, region.d)
  }

  override getConstructorParams() {
    return [this.params] as const
  }

  override visualize(): GraphicsObject {
    const colorByConnectionName = new Map(
      this.planner.routes.map((route, index) => [
        route.connection.connectionId,
        ROUTE_COLORS[index % ROUTE_COLORS.length]!,
      ]),
    )
    return {
      coordinateSystem: "cartesian",
      lines: this.connectionsWithResults.flatMap((result) => {
        const path = result.path ?? []
        return path.slice(1).map((point, index) => ({
          points: [path[index]!.point, point.point],
          strokeColor:
            colorByConnectionName.get(result.connection.name) ?? "#475569",
          strokeWidth: 0.05,
          label: `${result.connection.name} (z${point.z})`,
        }))
      }),
      points: [],
      rects: this.params.graph.regions.map((region) => ({
        center: region.d.center,
        width: Math.max(0.01, region.d.width - 0.04),
        height: Math.max(0.01, region.d.height - 0.04),
        fill: "rgba(226, 232, 240, 0.25)",
        stroke: "#94a3b8",
        label: `${region.regionId}\nz: ${region.d.availableZ.join(",")}`,
      })),
      circles: this.params.graph.ports.map((port) => {
        const assignment = this.assignedPortPoints.get(port.d.portId)
        return {
          center: { x: port.d.x, y: port.d.y },
          radius: 0.07,
          fill: assignment
            ? (colorByConnectionName.get(assignment.connectionName) ??
              "#475569")
            : "#cbd5e1",
          stroke: "#334155",
          label: `${port.d.portId}\nz${port.d.z}${assignment ? `\n${assignment.connectionName}` : "\nunassigned"}`,
        }
      }),
    }
  }
}
