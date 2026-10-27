import { BaseSolver } from "lib/solvers/BaseSolver"
import type { HighDensityIntraNodeRoute, NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"
import { getConnectionPortPointPairs } from "lib/utils/getConnectionPortPointPairs"
import { SingleTransitionIntraNodeSolver } from "./SingleTransitionIntraNodeSolver"
import { areSingleTransitionPlanarRoutesClear, type SingleTransitionBoardContext } from "./findSingleTransitionVia"

type Task = { connectionName: string; start: PortPoint; end: PortPoint }

/** Finite board-aware routing for transition tasks and optional planar peers. */
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
    if (!boardContext || transitions.length === 0) {
      this.failed = true
      this.error = "Requires board context and at least one transition task"
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
    const mandatoryPortPoints = [...(boardContext.mandatoryPortPoints ?? []), ...node.portPoints]
    if (!areSingleTransitionPlanarRoutesClear({ routes: allPlanarRoutes, context: { ...boardContext, mandatoryPortPoints }, center: node.center })) {
      this.failed = true
      this.error = "Planar tasks do not have clear direct copper"
      return
    }
    // Future tasks reserve only their actual endpoint copper, never guessed
    // straight chords. Completed tasks contribute their full wires and vias.
    const orders = transitions.length === 1 ? [transitions] : [transitions, [...transitions].reverse()]
    for (const order of orders) {
      const completed = new Map<Task, HighDensityIntraNodeRoute[]>()
      for (const transition of order) {
        const solver = new SingleTransitionIntraNodeSolver({
          nodeWithPortPoints: { ...node, portPoints: [transition.start, transition.end], portPointsInPairs: [[transition.start, transition.end]] },
          viaDiameter: params.viaDiameter,
          traceThickness: params.traceThickness,
          boardContext: { ...boardContext, planarRoutes: allPlanarRoutes, mandatoryPortPoints,
            routedPeerRoutes: [...(boardContext.routedPeerRoutes ?? []), ...completed.values()].flat() },
        })
        if (!solver.solved || solver.failed) {
          this.error = solver.error ?? "No certified finite transition placement"
          break
        }
        completed.set(transition, solver.solvedRoutes.map((route) => ({
          ...route, rootConnectionName: transition.start.rootConnectionName ?? transition.end.rootConnectionName,
        })))
      }
      if (completed.size !== transitions.length) continue
      this.solvedRoutes = [...planarRoutes, ...transitions.flatMap((task) => completed.get(task)!)]
      this.error = null
      this.solved = true
      return
    }
    this.failed = true
  }
}
