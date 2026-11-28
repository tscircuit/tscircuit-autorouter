import type { BaseSolver } from "lib/solvers/BaseSolver"
import {
  TinyHyperGraphSectionSolver,
  TinyHyperGraphSolver,
} from "tiny-hypergraph/lib/index"

export interface RouteLayerMaskState {
  allowedZByConnectionName?: ReadonlyMap<string, ReadonlySet<number>>
  baseReservationBySolver: WeakMap<TinyHyperGraphSolver, Int32Array>
  lastMaskedRouteIdBySolver: WeakMap<TinyHyperGraphSolver, number | undefined>
}

/** Reserve disallowed z-layer ports (`-2`) for the active route's `bus.allowedLayers` mask. */
export function applyActiveRouteLayerMask(
  solver: BaseSolver | null | undefined,
  maskState: RouteLayerMaskState,
): void {
  if (!maskState.allowedZByConnectionName?.size || !solver) return
  const target =
    solver instanceof TinyHyperGraphSectionSolver
      ? solver.activeSubSolver instanceof TinyHyperGraphSolver
        ? solver.activeSubSolver
        : undefined
      : solver instanceof TinyHyperGraphSolver
        ? solver
        : undefined
  if (!target) return

  const nestedSolver = Reflect.get(target, "greedyFinalRouteSolver")
  const activeSolver =
    nestedSolver instanceof TinyHyperGraphSolver ? nestedSolver : target

  const reserved = activeSolver.problemSetup?.portEndpointReservationNetId
  if (!reserved) return

  let baseReservation = maskState.baseReservationBySolver.get(activeSolver)
  if (!baseReservation) {
    baseReservation = new Int32Array(reserved)
    maskState.baseReservationBySolver.set(activeSolver, baseReservation)
  }
  const routeId =
    activeSolver.state.currentRouteId ?? activeSolver.state.unroutedRoutes[0]
  if (
    maskState.lastMaskedRouteIdBySolver.has(activeSolver) &&
    maskState.lastMaskedRouteIdBySolver.get(activeSolver) === routeId
  ) {
    return
  }
  maskState.lastMaskedRouteIdBySolver.set(activeSolver, routeId)

  const routeMeta =
    routeId !== undefined
      ? activeSolver.problem.routeMetadata?.[routeId]
      : undefined
  const connName =
    routeMeta?.simpleRouteConnection?.name ?? routeMeta?.connectionId
  const allowedZ = connName
    ? maskState.allowedZByConnectionName.get(connName)
    : undefined
  const startPort =
    routeId !== undefined
      ? activeSolver.problem.routeStartPort[routeId]
      : undefined
  const endPort =
    routeId !== undefined
      ? activeSolver.problem.routeEndPort[routeId]
      : undefined

  for (let portId = 0; portId < reserved.length; portId++) {
    const baseVal = baseReservation[portId]!
    if (!allowedZ) {
      reserved[portId] = baseVal
      continue
    }
    const isTerminal =
      portId === startPort ||
      portId === endPort ||
      Boolean(activeSolver.topology.portMetadata?.[portId]?._tinyTerminal)
    reserved[portId] =
      isTerminal || allowedZ.has(activeSolver.topology.portZ[portId]!)
        ? baseVal
        : -2
  }
}
