import { initializeAutorouterBindings } from "../initializeAutorouterBindings"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  registerDrcErrorForceBackend,
  registerPadClearanceBackend,
  registerTraceClearanceBackend,
  type DrcErrorForceBackend,
  type PadClearanceBackend,
  type TraceClearanceBackend,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "high-density-repair03/lib"
import * as bindings from "../../../rust/autorouter-bindings/pkg/autorouter_bindings.js"
import {
  loadAutorouterBindings,
  type AutorouterBindingsInput,
} from "../../../rust/autorouter-bindings/ts/index"

type Point = { x: number; y: number }
type PadResult = { point: Point | null; isPreferred: boolean }
type TraceResult = { points: Point[]; viaIdentityIndices: number[] }
type ForceResult = {
  changed: boolean
  routes: HighDensityRoute[]
  routeIndexes: number[]
  pointOrigins: Array<Array<number | null>>
}

export class TargetedRepairAdapter {
  private readonly binding: bindings.TargetedRepairEngine
  private connectivityJson: string

  constructor(srj: SimpleRouteJson, connMap?: ConnectivityMap) {
    initializeAutorouterBindings()
    this.connectivityJson = JSON.stringify(connMap
      ? { idToNetMap: connMap.idToNetMap }
      : null)
    this.binding = new bindings.TargetedRepairEngine(JSON.stringify(srj), this.connectivityJson)
  }

  private synchronizeConnectivity(connMap?: ConnectivityMap): void {
    const connectivityJson = JSON.stringify(connMap
      ? { idToNetMap: connMap.idToNetMap }
      : null)
    if (connectivityJson !== this.connectivityJson) {
      this.binding.setConnectivity(connectivityJson)
      this.connectivityJson = connectivityJson
    }
  }

  applyForces(
    routes: HighDensityRoute[],
    errors: Array<Record<string, unknown>>,
    traceRouteIndexById: Map<string, number>,
    scale: number,
    connMap: ConnectivityMap | undefined,
    enableCanonicalPairRepairs: boolean,
    enableSameNetViaCanonicalization: boolean,
    allowSharedViaSiteMove: boolean,
    enableTraceViaOwnerTargeting: boolean,
  ): boolean {
    this.synchronizeConnectivity(connMap)
    const result = JSON.parse(this.binding.applyForces(
      JSON.stringify(routes),
      JSON.stringify(errors),
      JSON.stringify(Object.fromEntries(traceRouteIndexById)),
      scale,
      enableCanonicalPairRepairs,
      enableSameNetViaCanonicalization,
      allowSharedViaSiteMove,
      enableTraceViaOwnerTargeting,
    )) as ForceResult
    if (result.routes.length !== result.routeIndexes.length || result.pointOrigins.length !== result.routes.length) {
      throw new Error("Targeted repair changed the route count")
    }
    for (let outputIndex = 0; outputIndex < result.routes.length; outputIndex += 1) {
      const routeIndex = result.routeIndexes[outputIndex]!
      const route = routes[routeIndex]
      if (!route) throw new Error("Targeted repair returned an invalid route index")
      const output = result.routes[outputIndex]!
      const origins = result.pointOrigins[outputIndex]!
      if (origins.length !== output.route.length) {
        throw new Error("Targeted repair omitted point origins")
      }
      const originalPoints = [...route.route]
      const points = output.route.map((point, pointIndex) => {
        const origin = origins[pointIndex]
        if (origin === null) return point
        const original = origin === undefined ? undefined : originalPoints[origin]
        if (!original) throw new Error("Targeted repair returned an invalid point origin")
        original.x = point.x
        original.y = point.y
        original.z = point.z
        return original
      })
      // The caller keeps references to mutable routes and their existing points.
      // Via materialization is performed by the caller after force application.
      route.route.splice(0, route.route.length, ...points)
    }
    return result.changed
  }

  findPadPosition(
    route: HighDensityRoute,
    preferred: Point,
    viaRadius: number,
    zLayers: readonly number[],
    connMap?: ConnectivityMap,
  ): Point | undefined {
    this.synchronizeConnectivity(connMap)
    const result = JSON.parse(this.binding.pad(
      JSON.stringify(route), JSON.stringify(preferred), viaRadius, JSON.stringify(zLayers),
    )) as PadResult
    if (result.point === null) return undefined
    return result.isPreferred ? preferred : result.point
  }
}

const contexts = new WeakMap<SimpleRouteJson, TargetedRepairAdapter>()

const applyDrcErrorForces: DrcErrorForceBackend = (
  srj, routes, errors, traceRouteIndexById, scale, connMap,
  enableCanonicalPairRepairs, enableSameNetViaCanonicalization,
  allowSharedViaSiteMove, enableTraceViaOwnerTargeting,
): boolean => {
  let context = contexts.get(srj)
  if (!context) {
    context = new TargetedRepairAdapter(srj, connMap)
    contexts.set(srj, context)
  }
  return context.applyForces(
    routes, errors, traceRouteIndexById, scale, connMap,
    enableCanonicalPairRepairs, enableSameNetViaCanonicalization,
    allowSharedViaSiteMove, enableTraceViaOwnerTargeting,
  )
}

const findPadPosition: PadClearanceBackend = (
  srj, route, preferred, viaRadius, zLayers, connMap,
): Point | undefined => {
  let context = contexts.get(srj)
  if (!context) {
    context = new TargetedRepairAdapter(srj, connMap)
    contexts.set(srj, context)
  }
  return context.findPadPosition(route, preferred, viaRadius, zLayers, connMap)
}

const findTracePositions: TraceClearanceBackend = (
  via, segments, clearance, connMap,
): Point[] => {
  const connectivityJson = JSON.stringify(connMap
    ? { idToNetMap: connMap.idToNetMap }
    : null)
  const result = JSON.parse(bindings.TargetedRepairEngine.trace(
    JSON.stringify(via), JSON.stringify(segments), clearance, connectivityJson,
  )) as TraceResult
  for (const index of result.viaIdentityIndices) {
    if (!result.points[index]) throw new Error("Trace placement returned an invalid via identity index")
    result.points[index] = via
  }
  return result.points
}

export async function loadTargetedRepairBindings(input: AutorouterBindingsInput): Promise<void> {
  await loadAutorouterBindings(input)
}

registerDrcErrorForceBackend(applyDrcErrorForces)
registerPadClearanceBackend(findPadPosition)
registerTraceClearanceBackend(findTracePositions)
