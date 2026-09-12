import { initializeAutorouterBindings } from "../initializeAutorouterBindings"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { HighDensityRoute, SimpleRouteJson } from "high-density-repair03/lib"
import * as bindings from "../../../rust/autorouter-bindings/pkg/autorouter_bindings.js"
import {
  loadAutorouterBindings,
  type AutorouterBindingsInput,
} from "../../../rust/autorouter-bindings/ts/index"
import {
  registerBroadRepulsionBackend,
  type BroadRepulsionBackend,
} from "./broadRepulsionRegistration"

type BroadRepulsionResult = {
  changed: boolean
  routes: HighDensityRoute[]
}

export class BroadRepulsionAdapter {
  private readonly binding: bindings.BroadRepulsionEngine
  private connectivityJson: string

  constructor(srj: SimpleRouteJson, connMap?: ConnectivityMap) {
    initializeAutorouterBindings()
    this.connectivityJson = JSON.stringify(connMap
      ? { netMap: connMap.netMap, idToNetMap: connMap.idToNetMap }
      : null)
    this.binding = new bindings.BroadRepulsionEngine(JSON.stringify(srj), this.connectivityJson)
  }

  run(
    routes: HighDensityRoute[],
    effort: number,
    passMultiplier: number,
    connMap: ConnectivityMap | undefined,
    allowSameNetViaPairs: boolean,
    runFinalViaSegmentCleanup: boolean,
  ): HighDensityRoute[] {
    const connectivityJson = JSON.stringify(connMap
      ? { netMap: connMap.netMap, idToNetMap: connMap.idToNetMap }
      : null)
    if (connectivityJson !== this.connectivityJson) {
      this.binding.setConnectivity(connectivityJson)
      this.connectivityJson = connectivityJson
    }
    const result = JSON.parse(this.binding.run(
      JSON.stringify(routes),
      effort,
      passMultiplier,
      allowSameNetViaPairs,
      runFinalViaSegmentCleanup,
    )) as BroadRepulsionResult
    return result.changed ? result.routes : routes
  }
}

const contexts = new WeakMap<SimpleRouteJson, BroadRepulsionAdapter>()

const applyBroadRepulsion: BroadRepulsionBackend = (
  srj,
  routes,
  effort,
  passMultiplier,
  connMap,
  allowSameNetViaPairs,
  runFinalViaSegmentCleanup,
): HighDensityRoute[] => {
  let context = contexts.get(srj)
  if (!context) {
    context = new BroadRepulsionAdapter(srj, connMap)
    contexts.set(srj, context)
  }
  return context.run(
    routes,
    effort,
    passMultiplier,
    connMap,
    allowSameNetViaPairs,
    runFinalViaSegmentCleanup,
  )
}

export async function loadBroadRepulsionBindings(input: AutorouterBindingsInput): Promise<void> {
  await loadAutorouterBindings(input)
}

registerBroadRepulsionBackend(applyBroadRepulsion)
