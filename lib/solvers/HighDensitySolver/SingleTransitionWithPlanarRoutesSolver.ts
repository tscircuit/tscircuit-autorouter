import { BaseSolver } from "lib/solvers/BaseSolver"
import type { HighDensityIntraNodeRoute, NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"
import { getConnectionPortPointPairs } from "lib/utils/getConnectionPortPointPairs"
import { SingleTransitionIntraNodeSolver } from "./SingleTransitionIntraNodeSolver"
import { areSingleTransitionPlanarRoutesClear, type SingleTransitionBoardContext } from "./findSingleTransitionVia"

type Task = { connectionName: string; start: PortPoint; end: PortPoint }

/** Finite board-aware placement for one transition beside fixed planar tasks. */
export class SingleTransitionWithPlanarRoutesSolver extends BaseSolver {
  solvedRoutes: HighDensityIntraNodeRoute[] = []

  override getSolverName(): string {
    return "SingleTransitionWithPlanarRoutesSolver"
  }

  constructor(params: {
    nodeWithPortPoints: NodeWithPortPoints
    viaDiameter?: number
    traceThickness?: number
    boardContext?: SingleTransitionBoardContext
  }) {
    super()
    const { nodeWithPortPoints: node, boardContext } = params
    const groups = new Map<string, PortPoint[]>()
    for (const point of node.portPoints) {
      const group = groups.get(point.connectionName) ?? []
      group.push(point)
      groups.set(point.connectionName, group)
    }
    const tasks: Task[] = []
    for (const [connectionName, points] of groups) {
      for (const [start, end] of getConnectionPortPointPairs(points)) tasks.push({ connectionName, start, end })
    }
    const transitions = tasks.filter((task) => task.start.z !== task.end.z)
    const planar = tasks.filter((task) => task.start.z === task.end.z)
    if (!boardContext || transitions.length !== 1 || planar.length === 0) {
      this.failed = true
      this.error = "Requires board context, exactly one transition and at least one planar task"
      return
    }
    const planarRoutes: HighDensityIntraNodeRoute[] = planar.map((task) => ({
      connectionName: task.connectionName,
      rootConnectionName: task.start.rootConnectionName ?? task.end.rootConnectionName,
      regionId: node.capacityMeshNodeId,
      route: [task.start, task.end].map((p) => ({ x: p.x, y: p.y, z: p.z })),
      traceThickness: params.traceThickness ?? 0.15,
      viaDiameter: params.viaDiameter ?? 0.3,
      vias: [],
    }))
    const allPlanarRoutes = [...(boardContext.planarRoutes ?? []), ...planarRoutes]
    if (!areSingleTransitionPlanarRoutesClear({ routes: allPlanarRoutes, context: boardContext, center: node.center })) {
      this.failed = true
      this.error = "Planar tasks do not have clear direct copper"
      return
    }
    const transition = transitions[0]!
    const solver = new SingleTransitionIntraNodeSolver({
      nodeWithPortPoints: { ...node, portPoints: [transition.start, transition.end], portPointsInPairs: [[transition.start, transition.end]] },
      viaDiameter: params.viaDiameter,
      traceThickness: params.traceThickness,
      boardContext: { ...boardContext, planarRoutes: allPlanarRoutes },
    })
    if (!solver.solved || solver.failed) {
      this.failed = true
      this.error = solver.error ?? "No certified transition beside the planar tasks"
      return
    }
    this.solvedRoutes = [...planarRoutes, ...solver.solvedRoutes.map((route) => ({
      ...route, rootConnectionName: transition.start.rootConnectionName ?? transition.end.rootConnectionName,
    }))]
    this.solved = true
  }
}
