import type { GraphicsObject } from "graphics-debug"
import { createRectFromCapacityNode } from "lib/utils/createRectFromCapacityNode"
import { TinyHyperGraphSolver, type TinyHyperGraphProblem } from "tiny-hypergraph/lib/index"

/** Search one alternate route while retaining every other committed assignment. */
export class RegionAvoidingRouteSolver extends TinyHyperGraphSolver {
  searchExhausted = false

  constructor(
    incumbent: TinyHyperGraphSolver,
    readonly routeId: number,
    readonly avoidedRegionId: number,
    maxIterations: number,
    portSectionMask: Int8Array,
  ) {
    const initialAssignments: NonNullable<TinyHyperGraphProblem["initialAssignments"]> = []
    for (let regionId = 0; regionId < incumbent.topology.regionCount; regionId++) {
      for (const [assignedRouteId, fromPortId, toPortId] of incumbent.state.regionSegments[regionId]) {
        if (assignedRouteId === routeId) continue
        initialAssignments.push({ routeId: assignedRouteId, regionId, fromPortId, toPortId })
      }
    }
    super(incumbent.topology, { ...incumbent.problem, initialAssignments, portSectionMask: new Int8Array(portSectionMask) }, {
      minViaPadDiameter: incumbent.minViaPadDiameter,
      STATIC_REACHABILITY_PRECHECK: false,
      MAX_ITERATIONS: maxIterations + 1,
      ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false,
      USE_SPARSE_CANDIDATE_STORAGE: true,
    })
    if (this.state.unroutedRoutes.length !== 1 || this.state.unroutedRoutes[0] !== routeId) {
      throw new Error(`RegionAvoidingRouteSolver: expected only route ${routeId} to be unrouted`)
    }
  }

  override isRegionReservedForDifferentNet(regionId: number): boolean {
    const isAvoidedRegion =
      this.state.currentRouteId === this.routeId &&
      regionId === this.avoidedRegionId
    return isAvoidedRegion || super.isRegionReservedForDifferentNet(regionId)
  }

  override visualize(): GraphicsObject {
    const graphics = super.visualize()
    // The exclusion is local to this trial; never mark it as a board obstacle.
    if (this.solved || this.failed) return graphics
    const regionId = this.avoidedRegionId
    const availableZ = Array.from({ length: 32 }, (_, z) => z)
      .filter(z => (this.topology.regionAvailableZMask[regionId] & (1 << z)) !== 0)
    const node = {
      capacityMeshNodeId: String(regionId),
      center: { x: this.topology.regionCenterX[regionId], y: this.topology.regionCenterY[regionId] },
      width: this.topology.regionWidth[regionId], height: this.topology.regionHeight[regionId],
      availableZ,
    }
    graphics.rects ??= []
    graphics.rects.push({ ...createRectFromCapacityNode(node), center: node.center,
      width: node.width, height: node.height, fill: "rgba(255,0,0,0.28)", stroke: "red",
      label: `TEMPORARY OBSTACLE: region ${regionId}, route ${this.routeId} only`,
    })
    return graphics
  }

  override onOutOfCandidates(): void {
    // Expected search exhaustion is explicit; internal errors remain fatal.
    this.searchExhausted = true
    this.failed = true
    this.error = `No alternate path for route ${this.routeId} avoiding region ${this.avoidedRegionId}`
    this.state.candidateQueue.clear()
  }

  override onAllRoutesRouted(): void {
    if (this.state.unroutedRoutes.length !== 0 || this.state.currentRouteId !== undefined) {
      throw new Error("RegionAvoidingRouteSolver: completed with an unfinished route")
    }
    this.solved = true
    this.progress = 1
  }
}
