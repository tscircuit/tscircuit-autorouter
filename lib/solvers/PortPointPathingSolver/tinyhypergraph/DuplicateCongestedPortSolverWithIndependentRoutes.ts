import {
  DuplicateCongestedPortSolver,
  TinyHyperGraphSolver,
  loadSerializedHyperGraph,
  type TinyHyperGraphProblem,
  type TinyHyperGraphSolverOptions,
} from "tiny-hypergraph/lib/index"

export type IndependentRouteSegment = {
  connectionId: string
  regionId: string
  fromPortId: string
  toPortId: string
}

/** Retain paths already solved by the port-duplication prepass. */
export class DuplicateCongestedPortSolverWithIndependentRoutes extends DuplicateCongestedPortSolver {
  independentRouteSegments: readonly IndependentRouteSegment[] = []

  override _setup(): void {
    const { topology, problem } = loadSerializedHyperGraph(
      this.serializedHyperGraph,
    )
    if (this.options.useSerializedPortPenalties === false) {
      problem.portPenalty = undefined
    }
    const options: TinyHyperGraphSolverOptions = {
      RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
      STATIC_REACHABILITY_PRECHECK: false,
      ...this.options.routeSolveOptions,
    }
    const independentRouteSegments: IndependentRouteSegment[] = []
    const portUseCounts = new Map<string, number>()
    let routeSolver: TinyHyperGraphSolver | undefined

    for (let routeId = 0; routeId < problem.routeCount; routeId++) {
      const connectionId = problem.routeMetadata?.[routeId]?.connectionId
      if (typeof connectionId !== "string") {
        throw new Error(`Independent route ${routeId} has no connection identifier`)
      }
      const routeProblem: TinyHyperGraphProblem = {
        routeCount: 1,
        portSectionMask: problem.portSectionMask,
        routeMetadata: problem.routeMetadata === undefined
          ? undefined
          : [problem.routeMetadata[routeId]],
        routeStartPort: Int32Array.from([problem.routeStartPort[routeId]!]),
        routeEndPort: Int32Array.from([problem.routeEndPort[routeId]!]),
        routeNet: Int32Array.from([problem.routeNet[routeId]!]),
        regionNetId: problem.regionNetId,
        portPenalty: problem.portPenalty,
      }
      if (routeSolver) {
        routeSolver.resetForProblem(routeProblem)
      } else {
        routeSolver = new TinyHyperGraphSolver(topology, routeProblem, options)
      }
      routeSolver.solve()
      if (!routeSolver.solved || routeSolver.failed) {
        throw new Error(
          `Connection "${connectionId}" could not be solved independently: ${routeSolver.error ?? "unknown error"}`,
        )
      }

      const usedPortIds = new Set<number>()
      for (let regionId = 0; regionId < topology.regionCount; regionId++) {
        for (const [, fromPortId, toPortId] of routeSolver.state.regionSegments[regionId]!) {
          const regionMetadata = topology.regionMetadata?.[regionId] as
            | { serializedRegionId?: string }
            | undefined
          const fromMetadata = topology.portMetadata?.[fromPortId] as
            | { serializedPortId?: string }
            | undefined
          const toMetadata = topology.portMetadata?.[toPortId] as
            | { serializedPortId?: string }
            | undefined
          if (
            regionMetadata?.serializedRegionId === undefined ||
            fromMetadata?.serializedPortId === undefined ||
            toMetadata?.serializedPortId === undefined
          ) {
            throw new Error(`Independent route "${connectionId}" is missing serialized segment identifiers`)
          }
          independentRouteSegments.push({
            connectionId,
            regionId: regionMetadata.serializedRegionId,
            fromPortId: fromMetadata.serializedPortId,
            toPortId: toMetadata.serializedPortId,
          })
          usedPortIds.add(fromPortId)
          usedPortIds.add(toPortId)
        }
      }
      if (usedPortIds.size === 0) {
        usedPortIds.add(routeProblem.routeStartPort[0]!)
        usedPortIds.add(routeProblem.routeEndPort[0]!)
      }
      for (const portId of usedPortIds) {
        const metadata = topology.portMetadata?.[portId] as
          | { serializedPortId?: string }
          | undefined
        const portIdString = metadata?.serializedPortId
        if (portIdString === undefined) {
          throw new Error(`Independent route "${connectionId}" is missing serialized port ${portId}`)
        }
        portUseCounts.set(portIdString, (portUseCounts.get(portIdString) ?? 0) + 1)
      }
    }

    // The inherited implementation uses precisely these counts to clone and
    // duplicate ports. Retaining paths changes neither its topology nor slots.
    this.revisedSerializedHyperGraph = this.duplicateCongestedPorts(portUseCounts)
    this.independentRouteSegments = independentRouteSegments
    this.stats = {
      ...this.stats,
      duplicateSourcePortCount: this.report.duplicatedPorts.length,
      duplicatedPortCount: this.report.duplicatedPorts.reduce(
        (sum, duplicatedPort) => sum + duplicatedPort.duplicatePortIds.length,
        0,
      ),
      independentRouteSegmentCount: independentRouteSegments.length,
    }
    this.solved = true
  }
}
