import { segmentToBoxMinDistance } from "@tscircuit/math-utils"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import { createObjectsWithZLayers } from "lib/utils/createObjectsWithZLayers"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import { BaseSolver } from "../BaseSolver"
import { breakRouteIntoSections } from "../UselessViaRemovalSolver/break-route-into-sections"

export interface GlobalLayerAssignmentSolverInput {
  hdRoutes: HighDensityRoute[]
  fixedHdRoutes?: ReadonlyArray<HighDensityRoute>
  obstacles: Obstacle[]
  connMap: ConnectivityMap
  layerCount: number
  traceClearance?: number
  obstacleClearance?: number
  protectedConnectionNames?: ReadonlySet<string>
}

type SectionNode = {
  index: number
  routeIndex: number
  sectionIndex: number
  z: number
  targetZ: number
  points: HighDensityRoute["route"]
  flippable: boolean
  fixed: boolean
}

type Bounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

type WeightedEdge = {
  left: number
  right: number
  weight: number
}

const EXACT_COMPONENT_LIMIT = 18

export class GlobalLayerAssignmentSolver extends BaseSolver {
  private readonly input: GlobalLayerAssignmentSolverInput
  private readonly traceClearance: number
  private readonly obstacleClearance: number
  private optimizedHdRoutes: HighDensityRoute[]

  override getSolverName(): string {
    return "GlobalLayerAssignmentSolver"
  }

  constructor(input: GlobalLayerAssignmentSolverInput) {
    super()
    this.input = input
    this.traceClearance = input.traceClearance ?? 0.1
    this.obstacleClearance = input.obstacleClearance ?? 0.1
    this.optimizedHdRoutes = input.hdRoutes
    this.MAX_ITERATIONS = 1
  }

  private routesAreSameNet(
    left: HighDensityRoute,
    right: HighDensityRoute,
  ): boolean {
    const leftId = left.rootConnectionName ?? left.connectionName
    const rightId = right.rootConnectionName ?? right.connectionName
    return (
      leftId === rightId || this.input.connMap.areIdsConnected(leftId, rightId)
    )
  }

  private routeIsConnectedToObstacle(
    route: HighDensityRoute,
    obstacle: Obstacle,
  ): boolean {
    const routeId = route.rootConnectionName ?? route.connectionName
    return obstacle.connectedTo.some(
      (connectedId) =>
        connectedId === routeId ||
        this.input.connMap.areIdsConnected(connectedId, routeId),
    )
  }

  private routeIsProtected(route: HighDensityRoute): boolean {
    const protectedConnectionNames = this.input.protectedConnectionNames
    if (!protectedConnectionNames?.size) return false
    const routeId = route.rootConnectionName ?? route.connectionName
    return [...protectedConnectionNames].some(
      (connectionName) =>
        connectionName === routeId ||
        this.input.connMap.areIdsConnected(connectionName, routeId),
    )
  }

  private endpointSupportsLayer(
    route: HighDensityRoute,
    point: { x: number; y: number },
    targetZ: number,
    obstacleIndex: ObstacleSpatialHashIndex,
  ): boolean {
    const nearbyObstacles = obstacleIndex
      .searchArea(point.x, point.y, 0.02, 0.02)
      .filter(
        (obstacle) =>
          Math.abs(point.x - obstacle.center.x) <=
            obstacle.width / 2 + 1e-6 &&
          Math.abs(point.y - obstacle.center.y) <=
            obstacle.height / 2 + 1e-6 &&
          this.routeIsConnectedToObstacle(route, obstacle),
      )
    if (nearbyObstacles.length === 0) return true
    return nearbyObstacles.some((obstacle) =>
      obstacle.__zLayers?.includes(targetZ),
    )
  }

  private sectionClearsTargetLayer(
    route: HighDensityRoute,
    points: HighDensityRoute["route"],
    targetZ: number,
    obstacleIndex: ObstacleSpatialHashIndex,
  ): boolean {
    const clearance = route.traceThickness / 2 + this.obstacleClearance
    const bounds = this.getExpandedBounds(points, clearance)
    const obstacles = obstacleIndex.search(bounds)
    for (const obstacle of obstacles) {
      if (
        !obstacle.__zLayers?.includes(targetZ) ||
        this.routeIsConnectedToObstacle(route, obstacle)
      ) {
        continue
      }
      for (let pointIndex = 1; pointIndex < points.length; pointIndex++) {
        if (
          segmentToBoxMinDistance(
            points[pointIndex - 1]!,
            points[pointIndex]!,
            obstacle,
          ) < clearance
        ) {
          return false
        }
      }
    }
    return true
  }

  private getExpandedBounds(
    points: HighDensityRoute["route"],
    margin: number,
  ): Bounds {
    return {
      minX: Math.min(...points.map((point) => point.x)) - margin,
      maxX: Math.max(...points.map((point) => point.x)) + margin,
      minY: Math.min(...points.map((point) => point.y)) - margin,
      maxY: Math.max(...points.map((point) => point.y)) + margin,
    }
  }

  private buildSectionNodes(
    allRoutes: HighDensityRoute[],
    mutableRouteCount: number,
    obstacleIndex: ObstacleSpatialHashIndex,
  ): { sectionNodes: SectionNode[]; sectionNodesByRoute: SectionNode[][] } {
    const sectionNodes: SectionNode[] = []
    const sectionNodesByRoute: SectionNode[][] = []
    for (let routeIndex = 0; routeIndex < allRoutes.length; routeIndex++) {
      const route = allRoutes[routeIndex]!
      const sections = breakRouteIntoSections(route)
      const routeNodes: SectionNode[] = []
      for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
        const section = sections[sectionIndex]!
        if (section.z !== 0 && section.z !== 1) {
          throw new Error(
            `Global layer assignment expected z=0 or z=1, got z=${section.z}`,
          )
        }
        const fixed = routeIndex >= mutableRouteCount
        const targetZ = section.z === 0 ? 1 : 0
        const touchesStart = sectionIndex === 0
        const touchesEnd = sectionIndex === sections.length - 1
        const hasProtectedGeometry =
          this.routeIsProtected(route) ||
          Boolean(route.jumpers?.length) ||
          section.points.some(
            (point) => point.insideJumperPad || point.toNextSegmentType,
          )
        const flippable =
          !fixed &&
          !hasProtectedGeometry &&
          (!touchesStart ||
            this.endpointSupportsLayer(
              route,
              route.route[0]!,
              targetZ,
              obstacleIndex,
            )) &&
          (!touchesEnd ||
            this.endpointSupportsLayer(
              route,
              route.route.at(-1)!,
              targetZ,
              obstacleIndex,
            )) &&
          this.sectionClearsTargetLayer(
            route,
            section.points,
            targetZ,
            obstacleIndex,
          )
        const node: SectionNode = {
          index: sectionNodes.length,
          routeIndex,
          sectionIndex,
          z: section.z,
          targetZ,
          points: section.points,
          flippable,
          fixed,
        }
        sectionNodes.push(node)
        routeNodes.push(node)
      }
      sectionNodesByRoute.push(routeNodes)
    }
    return { sectionNodes, sectionNodesByRoute }
  }

  private buildCandidateSectionPairs(
    sectionNodes: SectionNode[],
    allRoutes: HighDensityRoute[],
  ): Array<[number, number]> {
    const expandedBounds = sectionNodes.map((node) => {
      const route = allRoutes[node.routeIndex]!
      return this.getExpandedBounds(
        node.points,
        route.traceThickness / 2 + this.traceClearance,
      )
    })
    const sectionIndicesByMinX = sectionNodes
      .map((node) => node.index)
      .sort(
        (leftIndex, rightIndex) =>
          expandedBounds[leftIndex]!.minX -
          expandedBounds[rightIndex]!.minX,
      )
    const candidatePairs: Array<[number, number]> = []
    for (
      let leftPosition = 0;
      leftPosition < sectionIndicesByMinX.length;
      leftPosition++
    ) {
      const leftIndex = sectionIndicesByMinX[leftPosition]!
      const leftBounds = expandedBounds[leftIndex]!
      for (
        let rightPosition = leftPosition + 1;
        rightPosition < sectionIndicesByMinX.length;
        rightPosition++
      ) {
        const rightIndex = sectionIndicesByMinX[rightPosition]!
        const rightBounds = expandedBounds[rightIndex]!
        if (rightBounds.minX > leftBounds.maxX) break
        if (
          rightBounds.minY > leftBounds.maxY ||
          rightBounds.maxY < leftBounds.minY
        ) {
          continue
        }
        candidatePairs.push([leftIndex, rightIndex])
      }
    }
    return candidatePairs
  }

  private sectionsConflict(
    left: SectionNode,
    right: SectionNode,
    allRoutes: HighDensityRoute[],
  ): boolean {
    const leftRoute = allRoutes[left.routeIndex]!
    const rightRoute = allRoutes[right.routeIndex]!
    const minimumClearance =
      leftRoute.traceThickness / 2 +
      rightRoute.traceThickness / 2 +
      this.traceClearance
    for (
      let leftPointIndex = 1;
      leftPointIndex < left.points.length;
      leftPointIndex++
    ) {
      for (
        let rightPointIndex = 1;
        rightPointIndex < right.points.length;
        rightPointIndex++
      ) {
        if (
          minimumDistanceBetweenSegments(
            left.points[leftPointIndex - 1]!,
            left.points[leftPointIndex]!,
            right.points[rightPointIndex - 1]!,
            right.points[rightPointIndex]!,
          ) <
          minimumClearance - 1e-6
        ) {
          return true
        }
      }
    }
    return false
  }

  private buildConflictComponents(
    sectionNodes: SectionNode[],
    allRoutes: HighDensityRoute[],
  ): { componentBySection: number[]; componentFlippable: Map<number, boolean> } {
    const parent = sectionNodes.map((node) => node.index)
    const find = (index: number): number => {
      if (parent[index] !== index) parent[index] = find(parent[index]!)
      return parent[index]!
    }
    const union = (left: number, right: number): void => {
      const leftRoot = find(left)
      const rightRoot = find(right)
      if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot
    }
    const candidatePairs = this.buildCandidateSectionPairs(
      sectionNodes,
      allRoutes,
    )
    let conflictCount = 0
    for (const [leftIndex, rightIndex] of candidatePairs) {
      const left = sectionNodes[leftIndex]!
      const right = sectionNodes[rightIndex]!
      const leftRoute = allRoutes[left.routeIndex]!
      const rightRoute = allRoutes[right.routeIndex]!
      if (
        left.routeIndex === right.routeIndex ||
        this.routesAreSameNet(leftRoute, rightRoute) ||
        !this.sectionsConflict(left, right, allRoutes)
      ) {
        continue
      }
      conflictCount++
      if (left.z !== right.z) {
        union(left.index, right.index)
      } else {
        left.flippable = false
        right.flippable = false
      }
    }
    const componentBySection = sectionNodes.map((node) => find(node.index))
    const componentFlippable = new Map<number, boolean>()
    for (const node of sectionNodes) {
      const component = componentBySection[node.index]!
      componentFlippable.set(
        component,
        (componentFlippable.get(component) ?? true) && node.flippable,
      )
    }
    this.stats.candidateConflictPairCount = candidatePairs.length
    this.stats.conflictCount = conflictCount
    this.stats.componentCount = componentFlippable.size
    return { componentBySection, componentFlippable }
  }

  private buildViaEdges(
    sectionNodesByRoute: SectionNode[][],
    mutableRouteCount: number,
    componentBySection: number[],
  ): WeightedEdge[] {
    const weights = new Map<string, number>()
    for (let routeIndex = 0; routeIndex < mutableRouteCount; routeIndex++) {
      const routeNodes = sectionNodesByRoute[routeIndex]!
      for (let sectionIndex = 1; sectionIndex < routeNodes.length; sectionIndex++) {
        const left = componentBySection[routeNodes[sectionIndex - 1]!.index]!
        const right = componentBySection[routeNodes[sectionIndex]!.index]!
        if (left === right) continue
        const key = left < right ? `${left}:${right}` : `${right}:${left}`
        weights.set(key, (weights.get(key) ?? 0) + 1)
      }
    }
    return [...weights.entries()].map(([key, weight]) => {
      const [left, right] = key.split(":").map(Number)
      return { left: left!, right: right!, weight }
    })
  }

  private solveExactAssignment(
    variableComponents: number[],
    edges: WeightedEdge[],
  ): Map<number, boolean> {
    const variableIndexByComponent = new Map(
      variableComponents.map((component, index) => [component, index]),
    )
    const adjacency = variableComponents.map(
      (): Array<{ otherIndex: number | null; weight: number }> => [],
    )
    for (const edge of edges) {
      const leftIndex = variableIndexByComponent.get(edge.left)
      const rightIndex = variableIndexByComponent.get(edge.right)
      if (leftIndex !== undefined) {
        adjacency[leftIndex]!.push({
          otherIndex: rightIndex ?? null,
          weight: edge.weight,
        })
      }
      if (rightIndex !== undefined) {
        adjacency[rightIndex]!.push({
          otherIndex: leftIndex ?? null,
          weight: edge.weight,
        })
      }
    }
    const values = variableComponents.map(() => false)
    let bestValues = [...values]
    let score = 0
    let bestScore = 0
    const assignmentCount = 2 ** variableComponents.length
    for (let step = 1; step < assignmentCount; step++) {
      const changedBit = 31 - Math.clz32(step & -step)
      const oldValue = values[changedBit]!
      let gain = 0
      for (const neighbor of adjacency[changedBit]!) {
        const otherValue =
          neighbor.otherIndex === null ? false : values[neighbor.otherIndex]!
        gain += oldValue === otherValue ? neighbor.weight : -neighbor.weight
      }
      values[changedBit] = !oldValue
      score += gain
      if (score > bestScore) {
        bestScore = score
        bestValues = [...values]
      }
    }
    return new Map(
      variableComponents.map((component, index) => [
        component,
        bestValues[index]!,
      ]),
    )
  }

  private solveGreedyAssignment(
    variableComponents: number[],
    edges: WeightedEdge[],
  ): Map<number, boolean> {
    const flipByComponent = new Map(
      variableComponents.map((component) => [component, false]),
    )
    while (true) {
      let bestComponent: number | undefined
      let bestGain = 0
      for (const component of variableComponents) {
        let gain = 0
        for (const edge of edges) {
          if (edge.left !== component && edge.right !== component) continue
          const other = edge.left === component ? edge.right : edge.left
          gain +=
            flipByComponent.get(component) ===
            (flipByComponent.get(other) ?? false)
              ? edge.weight
              : -edge.weight
        }
        if (gain > bestGain) {
          bestGain = gain
          bestComponent = component
        }
      }
      if (bestComponent === undefined) break
      flipByComponent.set(bestComponent, !flipByComponent.get(bestComponent))
    }
    return flipByComponent
  }

  private optimizeRoutes(): HighDensityRoute[] {
    if (this.input.layerCount !== 2) {
      this.stats.notApplicableLayerCount = this.input.layerCount
      return this.input.hdRoutes
    }
    const allRoutes = [
      ...this.input.hdRoutes,
      ...(this.input.fixedHdRoutes ?? []),
    ]
    const obstacles = createObjectsWithZLayers(
      this.input.obstacles,
      this.input.layerCount,
    )
    const obstacleIndex = new ObstacleSpatialHashIndex("flatbush", obstacles)
    const { sectionNodes, sectionNodesByRoute } = this.buildSectionNodes(
      allRoutes,
      this.input.hdRoutes.length,
      obstacleIndex,
    )
    const { componentBySection, componentFlippable } =
      this.buildConflictComponents(sectionNodes, allRoutes)
    const edges = this.buildViaEdges(
      sectionNodesByRoute,
      this.input.hdRoutes.length,
      componentBySection,
    )
    const variableComponents = [...componentFlippable.entries()]
      .filter(([, flippable]) => flippable)
      .map(([component]) => component)
    const flipByComponent =
      variableComponents.length <= EXACT_COMPONENT_LIMIT
        ? this.solveExactAssignment(variableComponents, edges)
        : this.solveGreedyAssignment(variableComponents, edges)
    const optimizedRoutes = this.input.hdRoutes.map((route, routeIndex) => {
      const flattenedRoute = sectionNodesByRoute[routeIndex]!.flatMap((node) => {
        const shouldFlip =
          flipByComponent.get(componentBySection[node.index]!) ?? false
        return node.points.map((point) => ({
          ...point,
          z: shouldFlip ? node.targetZ : node.z,
        }))
      })
      const dedupedRoute = flattenedRoute.filter((point, index, points) => {
        const previous = points[index - 1]
        return (
          !previous ||
          point.x !== previous.x ||
          point.y !== previous.y ||
          point.z !== previous.z
        )
      })
      const vias = dedupedRoute.slice(0, -1).flatMap((point, pointIndex) =>
        point.z !== dedupedRoute[pointIndex + 1]!.z
          ? [{ x: point.x, y: point.y }]
          : [],
      )
      return { ...route, route: dedupedRoute, vias }
    })
    const inputViaCount = this.input.hdRoutes.reduce(
      (total, route) => total + route.vias.length,
      0,
    )
    const outputViaCount = optimizedRoutes.reduce(
      (total, route) => total + route.vias.length,
      0,
    )
    this.stats.sectionCount = sectionNodes.length
    this.stats.flippableComponentCount = variableComponents.length
    this.stats.inputViaCount = inputViaCount
    this.stats.outputViaCount = outputViaCount
    this.stats.viasRemoved = inputViaCount - outputViaCount
    return optimizedRoutes
  }

  _step(): void {
    this.optimizedHdRoutes = this.optimizeRoutes()
    this.solved = true
  }

  getOutput(): HighDensityRoute[] {
    return this.optimizedHdRoutes
  }
}
