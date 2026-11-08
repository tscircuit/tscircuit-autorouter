import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { createDrcConnectivityMap } from "lib/utils/createDrcConnectivityMap"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { getSameNetCopperGapBridges } from "lib/utils/getSameNetCopperGapBridges"
import { createPipeline9AutoroutingDrcEvaluator } from "./createPipeline9AutoroutingDrcEvaluator"

type Parameters = {
  inputSrj: SimpleRouteJson
  srjWithPointPairs: SimpleRouteJson
  traces: readonly SimplifiedPcbTrace[]
}

export class Pipeline9SameNetCopperGapSolver extends BaseSolver {
  private bridges?: SimplifiedPcbTrace[]

  constructor(public readonly parameters: Parameters) {
    super()
    this.MAX_ITERATIONS = 1
  }

  override _step(): void {
    const { inputSrj, srjWithPointPairs } = this.parameters
    const traces = [...this.parameters.traces]
    const clearance =
      inputSrj.minTraceToPadEdgeClearance ??
      inputSrj.defaultObstacleMargin ??
      0.1
    const preloadedIds = new Set(
      inputSrj.traces?.map((trace) => trace.pcb_trace_id),
    )
    // The constructor receives complete final copper, including the retained
    // preloads. Evaluate each original ID exactly once, even if it was moved.
    const evaluated = traces.map((trace) =>
      preloadedIds.has(trace.pcb_trace_id)
        ? { ...trace, __replaces_pcb_trace_id: trace.pcb_trace_id }
        : trace,
    )
    const evaluate = createPipeline9AutoroutingDrcEvaluator({
      inputSrj,
      srjWithPointPairs,
      includeBoardClearance: true,
      drcOptions: {
        traceClearance: clearance,
        viaClearance: inputSrj.minViaHoleEdgeToViaHoleEdgeClearance ?? 0.1,
        // Adding same-net copper cannot open a connection. In partial routing
        // inputs, connections that belong to later phases may still be absent.
        includeTraceContinuity: false,
      },
    })
    const before = evaluate(evaluated)
    const existingErrors = new Set(
      before.errors.map((error) => JSON.stringify(error)),
    )
    const connMap = createDrcConnectivityMap(before.circuitJson)
    const declared = getConnectivityMapFromSimpleRouteJson({
      ...srjWithPointPairs,
      traces,
    })
    connMap.addConnections(
      Array.from(new Set(Object.values(declared.idToNetMap)), (net) =>
        declared.getIdsConnectedToNet(net),
      ),
    )
    this.bridges =
      clearance === 0
        ? []
        : getSameNetCopperGapBridges({
            circuitJson: before.circuitJson,
            traces,
            connMap,
            minimumClearance: clearance,
            traceWidth: inputSrj.minTraceWidth,
            validate: (bridges) => {
              const violations = evaluate([
                ...evaluated,
                ...bridges,
              ]).errors.filter(
                (error) => !existingErrors.has(JSON.stringify(error)),
              )
              if (violations.length) {
                throw new Error(
                  `Cannot close same-net copper gap without violating physical clearance: ${JSON.stringify(violations[0])}`,
                )
              }
            },
          })
    this.stats = {
      bridgeCount: this.bridges.length,
      existingErrorCount: before.errors.length,
    }
    this.progress = 1
    this.solved = true
  }

  override getConstructorParams(): readonly [Parameters] {
    return [this.parameters] as const
  }

  getOutput(): SimplifiedPcbTrace[] {
    if (!this.solved || !this.bridges)
      throw new Error("Cannot get same-net gap bridges before validation")
    return this.bridges
  }

  override visualize(): GraphicsObject {
    return convertSrjToGraphicsObject({
      ...this.parameters.inputSrj,
      traces: [
        ...this.parameters.traces,
        ...(this.solved ? this.getOutput() : []),
      ],
    })
  }
}
