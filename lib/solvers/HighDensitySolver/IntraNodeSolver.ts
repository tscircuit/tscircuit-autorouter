import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
import { cloneAndShuffleArray } from "lib/utils/cloneAndShuffleArray"
import { getBoundsFromNodeWithPortPoints } from "lib/utils/getBoundsFromNodeWithPortPoints"
import { getMinDistBetweenEnteringPoints } from "lib/utils/getMinDistBetweenEnteringPoints"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "../../types/high-density-types"
import type { Obstacle } from "../../types/srj-types"
import { BaseSolver } from "../BaseSolver"
import { safeTransparentize } from "../colors"
import { HighDensityHyperParameters } from "./HighDensityHyperParameters"
import type { SingleHighDensityRouteSolver, SingleRouteOptions } from "./SingleHighDensityRouteSolver"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "./SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import * as bindings from "../../../rust/autorouter-bindings/pkg/autorouter_bindings.js"
import { initializeAutorouterBindings } from "../../bindings/initializeAutorouterBindings"

const contexts = new WeakMap<object, bindings.IntraNodeRouteContext>()

type ConnectionPoint = { x: number; y: number; z: number }
type UnsolvedConnection = { connectionName: string; rootConnectionName?: string; points: ConnectionPoint[] }

const connectionLabel = (
  connectionName: string,
  rootConnectionName?: string,
  extraLines: string[] = [],
) =>
  [
    connectionName,
    rootConnectionName
      ? `rootConnectionName: ${rootConnectionName}`
      : undefined,
    ...extraLines,
  ]
    .filter(Boolean)
    .join("\n")

const pointKey = (point: ConnectionPoint) =>
  `${point.x.toFixed(6)},${point.y.toFixed(6)},${point.z}`

const dedupeConnectionPoints = (points: ConnectionPoint[]) => {
  const seen = new Set<string>()
  const deduped: ConnectionPoint[] = []

  for (const point of points) {
    const key = pointKey(point)
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(point)
  }

  return deduped
}

export class IntraNodeRouteSolver extends BaseSolver {
  private binding: bindings.IntraNodeRouteSolver | undefined
  private disposed = false
  private routeCount = 0
  private outputRevision = 0
  private diagnosticRevision = -1
  private synchronizingDiagnostics = false
  private diagnosticsObserved = false
  private diagnosticTargets: Record<string, unknown> = {}
  private diagnosticChildren?: Map<number, SingleHighDensityRouteSolver>
  private diagnosticObserver?: (solver: IntraNodeRouteSolver) => void

  override getSolverName(): string {
    return "IntraNodeRouteSolver"
  }

  nodeWithPortPoints: NodeWithPortPoints
  colorMap: Record<string, string>
  unsolvedConnections: {
    connectionName: string
    rootConnectionName?: string
    points: { x: number; y: number; z: number }[]
  }[]
  originalConnectionPointsByName: Map<string, ConnectionPoint[]>
  rootConnectionNameByConnectionName: Map<string, string>

  totalConnections: number
  solvedRoutes: HighDensityIntraNodeRoute[]
  failedSubSolvers: SingleHighDensityRouteSolver[]
  hyperParameters: Partial<HighDensityHyperParameters>
  minDistBetweenEnteringPoints: number
  viaDiameter: number
  traceWidth: number
  obstacleMargin: number
  captureSearchDebug: boolean
  rerouteAttemptsByConnection: Map<string, number>

  POSTROUTE_VIA_TRACE_CLEARANCE = 0.1
  MAX_POSTROUTE_REPAIR_ATTEMPTS = 2

  activeSubSolver: SingleHighDensityRouteSolver | null = null
  connMap?: ConnectivityMap

  // Legacy compat
  get failedSolvers() {
    return this.failedSubSolvers
  }

  // Legacy compat
  get activeSolver() {
    return this.activeSubSolver
  }

  constructor(params: {
    nodeWithPortPoints: NodeWithPortPoints
    colorMap?: Record<string, string>
    hyperParameters?: Partial<HighDensityHyperParameters>
    connMap?: ConnectivityMap
    viaDiameter?: number
    traceWidth?: number
    obstacleMargin?: number
    captureSearchDebug?: boolean
    obstacles?: Obstacle[]
    layerCount?: number
  }, private readonly sharedProps: object = params) {
    const { nodeWithPortPoints, colorMap } = params
    super()
    this.nodeWithPortPoints = nodeWithPortPoints
    this.colorMap = colorMap ?? {}
    this.solvedRoutes = []
    this.hyperParameters = params.hyperParameters ?? {}
    this.failedSubSolvers = []
    this.connMap = params.connMap
    this.viaDiameter = params.viaDiameter ?? 0.3
    this.traceWidth = params.traceWidth ?? 0.15
    this.obstacleMargin = params.obstacleMargin ?? 0.15
    this.captureSearchDebug = params.captureSearchDebug ?? true
    const unsolvedConnectionsMap: Map<string, ConnectionPoint[]> = new Map()
    this.rootConnectionNameByConnectionName = new Map()
    for (const {
      connectionName,
      rootConnectionName,
      x,
      y,
      z,
    } of nodeWithPortPoints.portPoints) {
      if (rootConnectionName) {
        this.rootConnectionNameByConnectionName.set(
          connectionName,
          rootConnectionName,
        )
      }
      unsolvedConnectionsMap.set(connectionName, [
        ...(unsolvedConnectionsMap.get(connectionName) ?? []),
        { x, y, z: z ?? 0 },
      ])
    }
    this.originalConnectionPointsByName = new Map(
      Array.from(unsolvedConnectionsMap.entries()).map(
        ([connectionName, points]) => [
          connectionName,
          dedupeConnectionPoints(points),
        ],
      ),
    )
    this.unsolvedConnections = Array.from(
      unsolvedConnectionsMap.entries().map(([connectionName, points]) => ({
        connectionName,
        rootConnectionName:
          this.rootConnectionNameByConnectionName.get(connectionName),
        points: dedupeConnectionPoints(points),
      })),
    )
    this.rerouteAttemptsByConnection = new Map()

    if (this.hyperParameters.SHUFFLE_SEED) {
      this.unsolvedConnections = cloneAndShuffleArray(
        this.unsolvedConnections,
        this.hyperParameters.SHUFFLE_SEED ?? 0,
      )

      // Shuffle the starting and ending points of each connection (some
      // algorithms are biased towards the start or end of a trace)
      this.unsolvedConnections = this.unsolvedConnections.map(
        ({ points, ...rest }, i) => ({
          ...rest,
          points: cloneAndShuffleArray(
            points,
            i * 7117 + (this.hyperParameters.SHUFFLE_SEED ?? 0),
          ),
        }),
      )
    }

    this.totalConnections = this.unsolvedConnections.length
    this.MAX_ITERATIONS = 1_000 * this.totalConnections ** 1.5

    this.minDistBetweenEnteringPoints = getMinDistBetweenEnteringPoints(
      this.nodeWithPortPoints,
    )
    this.installDiagnosticGetters()
  }

  private installDiagnosticGetters(): void {
    for (const key of ["unsolvedConnections", "rerouteAttemptsByConnection", "activeSubSolver", "failedSubSolvers"]) {
      this.diagnosticTargets[key] = (this as unknown as Record<string, unknown>)[key]
      Object.defineProperty(this, key, {
        enumerable: true, configurable: true,
        get: (): unknown => {
          if (!this.synchronizingDiagnostics && !this.diagnosticsObserved) {
            this.diagnosticsObserved = true
            this.diagnosticObserver?.(this)
          }
          this.synchronizeDiagnostics()
          return this.diagnosticTargets[key]
        },
        set: (value: unknown): void => { this.diagnosticTargets[key] = value },
      })
    }
  }

  protected getInitialUnsolvedConnections(): UnsolvedConnection[] {
    return this.diagnosticTargets.unsolvedConnections as UnsolvedConnection[]
  }

  setDiagnosticObserver(observer: (solver: IntraNodeRouteSolver) => void): void {
    this.diagnosticObserver = observer
    if (this.diagnosticsObserved) observer(this)
  }

  syncObservedDiagnostics(): void {
    if (this.diagnosticsObserved) this.synchronizeDiagnostics()
  }

  private getDiagnosticChild(id: number): SingleHighDensityRouteSolver {
    const children = this.diagnosticChildren ??= new Map()
    let child = children.get(id)
    if (child) return child
    if (!this.binding) throw new Error("Native child requires its parent router")
    const binding = this.binding.getChild(id)
    const nativeOptions = binding.options()
    const options: SingleRouteOptions = {
      ...nativeOptions,
      rootConnectionName: nativeOptions.rootConnectionName ?? undefined,
      regionId: nativeOptions.regionId ?? undefined,
      connMap: this.connMap,
    }
    const facade = new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost(options, binding)
    let lastRevision = -1
    let terminal = false
    child = new Proxy(facade, {
      get: (target, property): unknown => {
        const revision = this.binding?.getDiagnosticRevision()
        if (!terminal && (revision === undefined || revision !== lastRevision)) {
          target.refreshFromSolver()
          lastRevision = revision ?? -1
          terminal = target.solved || target.failed
        }
        const member: unknown = Reflect.get(target, property, target)
        return typeof member === "function" ? (...args: unknown[]): unknown => {
          const result: unknown = member.apply(target, args)
          lastRevision = -1
          return result
        } : member
      },
    })
    children.set(id, child)
    return child
  }

  private synchronizeDiagnostics(): void {
    if (this.synchronizingDiagnostics || !this.binding || this.disposed || this.cacheHit) return
    const revision = this.binding.getDiagnosticRevision()
    if (revision === this.diagnosticRevision) return
    this.synchronizingDiagnostics = true
    try {
      const state = this.binding.getDiagnostics()
      if (!state) return
      const connections = this.diagnosticTargets.unsolvedConnections as UnsolvedConnection[]
      const existing = new Map(connections.map((connection) => [JSON.stringify(connection), connection]))
      connections.splice(0, connections.length, ...state.unsolvedConnections.map((connection) => {
        const restored = { connectionName: connection.connectionName, rootConnectionName: connection.rootConnectionName, points: connection.points }
        return existing.get(JSON.stringify(restored)) ?? restored
      }))
      const attempts = this.diagnosticTargets.rerouteAttemptsByConnection as Map<string, number>
      attempts.clear()
      for (const [connection, count] of state.rerouteAttemptsByConnection) attempts.set(connection, count)
      this.activeSubSolver = state.activeChildId === null ? null : this.getDiagnosticChild(state.activeChildId)
      const failed = this.diagnosticTargets.failedSubSolvers as SingleHighDensityRouteSolver[]
      failed.splice(0, failed.length, ...state.failedChildIds.map((id) => this.getDiagnosticChild(id)))
      this.diagnosticRevision = revision
    } finally {
      this.synchronizingDiagnostics = false
    }
  }

  private getBinding(lazy = false): bindings.IntraNodeRouteSolver {
    initializeAutorouterBindings()
    if (this.disposed) throw new Error("General router WASM solver has been disposed")
    if (!this.binding) {
      let context = contexts.get(this.sharedProps)
      if (!context) {
        const names = new Set(this.nodeWithPortPoints.portPoints.map((point) => point.connectionName))
        const idToNetMap: Record<string, string> = {}
        for (const name of names) {
          const net = this.connMap?.getNetConnectedToId(name)
          if (net !== undefined) idToNetMap[name] = net
        }
        const node = this.nodeWithPortPoints
        const colorMap: Record<string, string> = {}
        for (const name of names) {
          if (this.colorMap[name] !== undefined) colorMap[name] = this.colorMap[name]
        }
        // Only transfer fields the Rust router consumes; portfolio props also
        // contain board-wide obstacles and metadata unrelated to this node.
        context = new bindings.IntraNodeRouteContext({
          nodeWithPortPoints: {
            capacityMeshNodeId: node.capacityMeshNodeId,
            center: node.center,
            width: node.width,
            height: node.height,
            availableZ: node.availableZ,
            portPoints: node.portPoints.map(({ connectionName, rootConnectionName, x, y, z }) => ({
              connectionName, rootConnectionName, x, y, z,
            })),
          },
          colorMap,
          viaDiameter: this.viaDiameter,
          traceWidth: this.traceWidth,
          obstacleMargin: this.obstacleMargin,
          captureSearchDebug: this.captureSearchDebug,
          connMap: this.connMap ? { netMap: {}, idToNetMap } : undefined,
        })
        contexts.set(this.sharedProps, context)
      }
      this.binding = lazy ? context.createLazy(this.hyperParameters) : context.create(this.hyperParameters)
    }
    return this.binding
  }

  shareForPortfolio(): number {
    return this.getBinding(true).shareForPortfolio()
  }

  syncPortfolioOutput(): void {
    if (!this.binding || ("cacheHit" in this && this.cacheHit)) return
    const revision = this.binding.getOutputRevision()
    if (revision === this.outputRevision) return
    this.solvedRoutes = this.binding.getOutput().map((route) => {
      const { connectionName, rootConnectionName, regionId, ...rest } = route
      return { connectionName, rootConnectionName, regionId, ...rest }
    })
    this.routeCount = this.solvedRoutes.length
    this.outputRevision = revision
  }

  override _step(): void {
    const binding = this.getBinding()
    const status = binding.step(this.iterations)
    const count = Math.floor(status / 4)
    this.solved = status % 2 === 1
    this.failed = Math.floor(status / 2) % 2 === 1
    if (this.failed) this.error = binding.error() ?? null
    if (count !== this.routeCount) {
      this.solvedRoutes = binding.getOutput()
      // Restore optional own properties that serde omits, preserving TS order.
      this.solvedRoutes = this.solvedRoutes.map((route) => {
        const { connectionName, rootConnectionName, regionId, ...rest } = route
        return { connectionName, rootConnectionName, regionId, ...rest }
      })
      this.routeCount = count
    }
    this.syncObservedDiagnostics()
  }

  computeProgress(): number {
    if (this.binding && !this.cacheHit) return this.binding.computeProgress()
    return this.solvedRoutes.length / this.totalConnections
  }

  visualize(): GraphicsObject {
    if (this.disposed) throw new Error("General router WASM solver has been disposed")
    if (this.binding && !("cacheHit" in this && this.cacheHit)) {
      return this.binding.visualize(safeTransparentize)
    }
    const graphics: GraphicsObject = {
      lines: [],
      points: [],
      rects: [],
      circles: [],
    }

    // Draw node bounds
    // graphics.rects!.push({
    //   center: {
    //     x: this.nodeWithPortPoints.center.x,
    //     y: this.nodeWithPortPoints.center.y,
    //   },
    //   width: this.nodeWithPortPoints.width,
    //   height: this.nodeWithPortPoints.height,
    //   stroke: "gray",
    //   fill: "transparent",
    // })

    // Visualize input nodeWithPortPoints
    for (const pt of this.nodeWithPortPoints.portPoints) {
      graphics.points!.push({
        x: pt.x,
        y: pt.y,
        label: connectionLabel(pt.connectionName, pt.rootConnectionName, [
          `layer: ${pt.z}`,
        ]),
        color: this.colorMap[pt.connectionName] ?? "blue",
      })
    }

    // Visualize solvedRoutes
    for (
      let routeIndex = 0;
      routeIndex < this.solvedRoutes.length;
      routeIndex++
    ) {
      const route = this.solvedRoutes[routeIndex]
      if (route.route.length > 0) {
        const routeColor = this.colorMap[route.connectionName] ?? "blue"
        const rootConnectionName =
          route.rootConnectionName ??
          this.rootConnectionNameByConnectionName.get(route.connectionName)

        // Draw route segments between points
        for (let i = 0; i < route.route.length - 1; i++) {
          const p1 = route.route[i]
          const p2 = route.route[i + 1]

          graphics.lines!.push({
            points: [p1, p2],
            label: connectionLabel(route.connectionName, rootConnectionName, [
              `layer: ${p1.z}`,
            ]),
            strokeColor:
              p1.z === 0
                ? safeTransparentize(routeColor, 0.2)
                : safeTransparentize(routeColor, 0.8),
            layer: `route-layer-${p1.z}`,
            step: routeIndex,
            strokeWidth: route.traceThickness,
          })
        }

        // Draw vias
        for (const via of route.vias) {
          graphics.circles!.push({
            center: { x: via.x, y: via.y },
            radius: route.viaDiameter / 2,
            fill: safeTransparentize(routeColor, 0.5),
            layer: "via",
            step: routeIndex,
            label: connectionLabel(route.connectionName, rootConnectionName, [
              "via",
            ]),
          })
        }
      }
    }

    // Draw border around the node
    const bounds = getBoundsFromNodeWithPortPoints(this.nodeWithPortPoints)
    const { minX, minY, maxX, maxY } = bounds

    // Draw the four sides of the border with thin red lines
    graphics.lines!.push({
      points: [
        { x: minX, y: minY },
        { x: maxX, y: minY },
        { x: maxX, y: maxY },
        { x: minX, y: maxY },
        { x: minX, y: minY },
      ],
      strokeColor: "rgba(255, 0, 0, 0.25)",
      strokeDash: "4 4",
      layer: "border",
    })

    return graphics
  }

  dispose(): void {
    if (this.diagnosticsObserved) this.synchronizeDiagnostics()
    this.binding?.free()
    this.binding = undefined
    this.disposed = true
  }
}
