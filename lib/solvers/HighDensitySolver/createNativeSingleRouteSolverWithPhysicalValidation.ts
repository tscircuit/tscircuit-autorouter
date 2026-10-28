import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Native } from "./SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

/** The callback describes manufactured geometry, including during scaled search. */
export const createNativeSingleRouteSolverWithPhysicalValidation = (
  opts: ConstructorParameters<typeof Native>[0],
  dimensions: { traceThickness: number; viaDiameter: number },
  validateRoute?: (route: HighDensityIntraNodeRoute) => boolean,
): Native => {
  if (!validateRoute) return new Native(opts)
  const fragment = (
    route: HighDensityIntraNodeRoute["route"],
    vias: HighDensityIntraNodeRoute["vias"],
  ): HighDensityIntraNodeRoute => ({
    connectionName: opts.connectionName, rootConnectionName: opts.rootConnectionName,
    regionId: opts.regionId, ...dimensions, route, vias,
  })
  return new class extends Native {
    override handleSimpleCases(): void {
      const { A, B } = opts
      const center = this.boundsCenter
      const route = A.z === B.z ? [A, B] : [A, { ...center, z: A.z }, { ...center, z: B.z }, B]
      if (validateRoute(fragment(route, A.z === B.z ? [] : [center]))) super.handleSimpleCases()
    }

    override isNodeTooCloseToObstacle(
      node: Node,
      margin?: number,
      isVia?: boolean,
      query?: Parameters<Native["isNodeTooCloseToObstacle"]>[3],
    ): boolean {
      if (super.isNodeTooCloseToObstacle(node, margin, isVia, query)) return true
      if (isVia !== true) return false
      if (!node.parent) throw new Error("Physical native via query is missing its parent")
      return !validateRoute(fragment([
        { x: node.x, y: node.y, z: node.parent.z },
        { x: node.x, y: node.y, z: node.z },
      ], [{ x: node.x, y: node.y }]))
    }

    override doesPathToParentIntersectObstacle(
      node: Node,
      query?: Parameters<Native["doesPathToParentIntersectObstacle"]>[1],
    ): boolean {
      if (super.doesPathToParentIntersectObstacle(node, query)) return true
      if (!node.parent || node.parent.z !== node.z) return false
      return !validateRoute(fragment([
        { x: node.parent.x, y: node.parent.y, z: node.parent.z },
        { x: node.x, y: node.y, z: node.z },
      ], []))
    }
  }(opts)
}
