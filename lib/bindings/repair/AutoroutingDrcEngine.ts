import { initializeAutorouterBindings } from "../initializeAutorouterBindings"
import type {
  AutoroutingDrcEngineOptions,
  AutoroutingDrcEngineRunStats,
  AutoroutingDrcResult,
  SimpleRouteJson,
  SimplifiedPcbTraces,
} from "high-density-repair03/lib"
import * as bindings from "../../../rust/autorouter-bindings/pkg/autorouter_bindings.js"

export class AutoroutingDrcEngine {
  private readonly binding: bindings.AutoroutingDrcEngine
  private readonly connMap: AutoroutingDrcEngineOptions["connMap"]
  private connectivitySnapshot: Record<string, string>

  constructor(srj: SimpleRouteJson, options: AutoroutingDrcEngineOptions = {}) {
    initializeAutorouterBindings()
    const { connMap, ...engineOptions } = options
    this.connMap = connMap
    this.connectivitySnapshot = { ...connMap?.idToNetMap }
    const connectivity = connMap
      ? { netMap: connMap.netMap, idToNetMap: connMap.idToNetMap }
      : undefined
    this.binding = new bindings.AutoroutingDrcEngine({
      bounds: srj.bounds,
      layerCount: srj.layerCount,
      minViaDiameter: srj.minViaDiameter,
      minViaEdgeToPadEdgeClearance: srj.minViaEdgeToPadEdgeClearance,
      connections: srj.connections.map((connection) => ({
        name: connection.name,
        rootConnectionName: connection.rootConnectionName,
        netConnectionName: connection.netConnectionName,
        mergedConnectionNames: connection.mergedConnectionNames,
        pointsToConnect: connection.pointsToConnect.map((point) => ({
          pointId: point.pointId,
          pcb_port_id: point.pcb_port_id,
        })),
      })),
      obstacles: srj.obstacles.map((obstacle) => ({
        center: obstacle.center,
        width: obstacle.width,
        height: obstacle.height,
        layers: obstacle.layers,
        connectedTo: obstacle.connectedTo,
        ccwRotationDegrees: obstacle.ccwRotationDegrees,
      })),
    }, connectivity, engineOptions)
  }

  forkForRepair(): bindings.AutoroutingDrcEngine {
    return this.binding.forkForRepair()
  }

  get lastRunStats(): AutoroutingDrcEngineRunStats {
    return this.binding.stats()
  }

  evaluate(traces: SimplifiedPcbTraces): AutoroutingDrcResult {
    return this.evaluateWithMode(traces, true)
  }

  evaluateLegacy(traces: SimplifiedPcbTraces): AutoroutingDrcResult {
    return this.evaluateWithMode(traces, false)
  }

  private evaluateWithMode(traces: SimplifiedPcbTraces, complete: boolean): AutoroutingDrcResult {
    const current = this.connMap?.idToNetMap
    if (current) {
      const keys = Object.keys(current)
      if (keys.length !== Object.keys(this.connectivitySnapshot).length ||
        keys.some((key) => current[key] !== this.connectivitySnapshot[key])) {
        this.binding.setConnectivity({ idToNetMap: current })
        this.connectivitySnapshot = { ...current }
      }
    }
    const result = this.binding.evaluate(traces, complete)
    result.errorsWithCenters = result.errors.filter((error) => error.center)
    result.locationAwareErrors = result.errorsWithCenters as AutoroutingDrcResult["locationAwareErrors"]
    return result
  }
}
