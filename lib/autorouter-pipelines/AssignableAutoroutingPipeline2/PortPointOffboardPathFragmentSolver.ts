import { BaseSolver } from "lib/solvers/BaseSolver"
import type { GraphicsObject } from "graphics-debug"
import type {
  SimpleRouteJson,
  Obstacle,
  OffBoardConnectionId,
} from "../../types"
import {
  createColorMapFromStrings,
  safeTransparentize,
} from "../../solvers/colors"

export interface OffboardPortPoint {
  portPointId: string
  x: number
  y: number
  /** The obstacle this port point is at the center of */
  obstacleIndex: number
  /** The offBoardConnectsTo ids this port point is associated with */
  offBoardConnectionIds: OffBoardConnectionId[]
  /** Available Z layers for this port point based on obstacle layers */
  availableZ: number[]
}

export interface OffboardPathFragment {
  pathFragmentId: string
  /** The shared offBoardConnectsTo id that connects these port points */
  offBoardConnectionId: OffBoardConnectionId
  /** The two port points connected by this path fragment */
  portPointIds: [string, string]
  /** Endpoints of this edge */
  start: { x: number; y: number }
  end: { x: number; y: number }
}

type Phase = "finding_obstacles" | "creating_fragments" | "done"

interface PendingFragment {
  offBoardId: OffBoardConnectionId
  pp1: OffboardPortPoint
  pp2: OffboardPortPoint
}

/**
 * PortPointOffboardPathFragmentSolver finds obstacles with offBoardConnectsTo
 * defined and creates port points at their centers. It then creates path
 * fragments (edges) connecting port points that share the same offBoardConnectsTo
 * ids.
 *
 * This enables routing through off-board connections like flex cables or
 * external connectors.
 *
 * The solver iterates step-by-step:
 * 1. Phase "finding_obstacles": Process one obstacle per step, creating port points
 * 2. Phase "creating_fragments": Create one path fragment per step
 * 3. Phase "done": Solver complete
 */
export class PortPointOffboardPathFragmentSolver extends BaseSolver {
  srj: SimpleRouteJson
  colorMap: Record<string, string>

  /** Current phase of the solver */
  phase: Phase = "finding_obstacles"

  /** Index of the current obstacle being processed */
  currentObstacleIndex = 0

  /** Obstacles that have offBoardConnectsTo defined */
  offboardObstacles: Array<{ obstacle: Obstacle; index: number }> = []

  /** Port points created at obstacle centers */
  portPoints: OffboardPortPoint[] = []

  /** Map from portPointId to OffboardPortPoint */
  portPointMap: Map<string, OffboardPortPoint> = new Map()

  /** Path fragments connecting port points with shared offBoardConnectsTo */
  pathFragments: OffboardPathFragment[] = []

  /** Map from offBoardConnectionId to port points that share it */
  offBoardConnectionToPortPoints: Map<
    OffBoardConnectionId,
    OffboardPortPoint[]
  > = new Map()

  /** Pending path fragments to create (computed after obstacle phase) */
  pendingFragments: PendingFragment[] = []

  /** Index of current fragment being created */
  currentFragmentIndex = 0

  /** Last processed obstacle (for visualization) */
  lastProcessedObstacle: { obstacle: Obstacle; index: number } | null = null

  /** Last created port point (for visualization) */
  lastCreatedPortPoint: OffboardPortPoint | null = null

  /** Last created path fragment (for visualization) */
  lastCreatedFragment: OffboardPathFragment | null = null

  /** Color map for offBoardConnectionIds */
  offBoardColorMap: Record<string, string> = {}

  constructor({
    srj,
    colorMap,
  }: {
    srj: SimpleRouteJson
    colorMap?: Record<string, string>
  }) {
    super()
    this.srj = srj
    this.colorMap = colorMap ?? {}

    // Precompute obstacles with offBoardConnectsTo and collect unique ids
    const obstacles = this.srj.obstacles ?? []
    const uniqueOffBoardIds = new Set<string>()

    for (let i = 0; i < obstacles.length; i++) {
      const obstacle = obstacles[i]
      if (
        obstacle.offBoardConnectsTo &&
        obstacle.offBoardConnectsTo.length > 0
      ) {
        this.offboardObstacles.push({ obstacle, index: i })
        for (const id of obstacle.offBoardConnectsTo) {
          uniqueOffBoardIds.add(id)
        }
      }
    }

    // Create color map from unique offBoardConnectionIds
    this.offBoardColorMap = createColorMapFromStrings([...uniqueOffBoardIds])

    // Set max iterations based on work to do
    // At minimum 1 iteration, otherwise obstacles + fragments
    this.MAX_ITERATIONS = Math.max(1, this.offboardObstacles.length * 10)
  }

  _step() {
    if (this.phase === "finding_obstacles") {
      this.stepFindingObstacles()
    } else if (this.phase === "creating_fragments") {
      this.stepCreatingFragments()
    } else {
      this.solved = true
    }
  }

  private stepFindingObstacles() {
    if (this.currentObstacleIndex >= this.offboardObstacles.length) {
      // Done finding obstacles, compute pending fragments and move to next phase
      this.computePendingFragments()
      if (this.pendingFragments.length === 0) {
        this.phase = "done"
        this.solved = true
      } else {
        this.phase = "creating_fragments"
      }
      return
    }

    const { obstacle, index } =
      this.offboardObstacles[this.currentObstacleIndex]
    this.lastProcessedObstacle = { obstacle, index }

    // Compute available Z from obstacle layers
    const availableZ =
      obstacle.zLayers ?? obstacle.layers.map((layer) => this.layerToZ(layer))

    const portPoint: OffboardPortPoint = {
      portPointId: `offboard_pp_${index}`,
      x: obstacle.center.x,
      y: obstacle.center.y,
      obstacleIndex: index,
      offBoardConnectionIds: obstacle.offBoardConnectsTo!,
      availableZ,
    }

    this.portPoints.push(portPoint)
    this.portPointMap.set(portPoint.portPointId, portPoint)
    this.lastCreatedPortPoint = portPoint

    // Index by offBoardConnectionId for quick lookup
    for (const offBoardId of obstacle.offBoardConnectsTo!) {
      if (!this.offBoardConnectionToPortPoints.has(offBoardId)) {
        this.offBoardConnectionToPortPoints.set(offBoardId, [])
      }
      this.offBoardConnectionToPortPoints.get(offBoardId)!.push(portPoint)
    }

    this.currentObstacleIndex++
  }

  private computePendingFragments() {
    // For each offBoardConnectionId, create edges between all port points that share it
    for (const [offBoardId, portPoints] of this
      .offBoardConnectionToPortPoints) {
      for (let i = 0; i < portPoints.length; i++) {
        for (let j = i + 1; j < portPoints.length; j++) {
          this.pendingFragments.push({
            offBoardId,
            pp1: portPoints[i],
            pp2: portPoints[j],
          })
        }
      }
    }
  }

  private stepCreatingFragments() {
    if (this.currentFragmentIndex >= this.pendingFragments.length) {
      this.phase = "done"
      this.solved = true
      return
    }

    const pending = this.pendingFragments[this.currentFragmentIndex]

    const pathFragment: OffboardPathFragment = {
      pathFragmentId: `offboard_frag_${this.currentFragmentIndex}`,
      offBoardConnectionId: pending.offBoardId,
      portPointIds: [pending.pp1.portPointId, pending.pp2.portPointId],
      start: { x: pending.pp1.x, y: pending.pp1.y },
      end: { x: pending.pp2.x, y: pending.pp2.y },
    }

    this.pathFragments.push(pathFragment)
    this.lastCreatedFragment = pathFragment

    this.currentFragmentIndex++
  }

  private layerToZ(layer: string): number {
    if (layer === "top") return 0
    if (layer === "bottom") return this.srj.layerCount - 1
    // Try to parse inner layer number
    const match = layer.match(/inner(\d+)/)
    if (match) {
      return parseInt(match[1], 10)
    }
    return 0
  }

  computeProgress(): number {
    const totalObstacles = this.offboardObstacles.length
    const totalFragments = this.pendingFragments.length

    if (this.phase === "finding_obstacles") {
      if (totalObstacles === 0) return 1
      return (this.currentObstacleIndex / totalObstacles) * 0.5
    } else if (this.phase === "creating_fragments") {
      if (totalFragments === 0) return 1
      return 0.5 + (this.currentFragmentIndex / totalFragments) * 0.5
    }
    return 1
  }

  visualize(): GraphicsObject {
    const graphics: GraphicsObject = {
      lines: [],
      points: [],
      rects: [],
    }

    // Draw all obstacles with offBoardConnectsTo (context)
    for (const { obstacle, index } of this.offboardObstacles) {
      const isLastProcessed = this.lastProcessedObstacle?.index === index
      const isNextToProcess =
        this.phase === "finding_obstacles" &&
        this.currentObstacleIndex < this.offboardObstacles.length &&
        this.offboardObstacles[this.currentObstacleIndex].index === index

      // Use color from first offBoardConnectsTo id
      const primaryOffBoardId = obstacle.offBoardConnectsTo?.[0]
      const baseColor = primaryOffBoardId
        ? this.offBoardColorMap[primaryOffBoardId]
        : "rgba(255, 165, 0, 1)"

      let fill = safeTransparentize(baseColor, 0.7)
      let stroke = baseColor

      if (isNextToProcess) {
        fill = "rgba(0, 255, 0, 0.4)"
        stroke = "rgba(0, 200, 0, 1)"
      } else if (isLastProcessed) {
        fill = safeTransparentize(baseColor, 0.5)
        stroke = baseColor
      }

      graphics.rects!.push({
        center: obstacle.center,
        width: obstacle.width,
        height: obstacle.height,
        fill,
        stroke,
        label: [
          `Obstacle ${index}`,
          `offBoard: ${obstacle.offBoardConnectsTo?.join(", ")}`,
          `layers: ${obstacle.layers.join(", ")}`,
          isNextToProcess ? ">>> NEXT <<<" : "",
          isLastProcessed ? "<<< LAST PROCESSED >>>" : "",
        ]
          .filter(Boolean)
          .join("\n"),
      })
    }

    // Draw all created port points as points (using color from first offBoardConnectionId)
    for (const portPoint of this.portPoints) {
      const isLast =
        this.lastCreatedPortPoint?.portPointId === portPoint.portPointId

      const primaryOffBoardId = portPoint.offBoardConnectionIds[0]
      const baseColor = primaryOffBoardId
        ? this.offBoardColorMap[primaryOffBoardId]
        : "rgba(255, 165, 0, 1)"

      graphics.points!.push({
        x: portPoint.x,
        y: portPoint.y,
        color: isLast ? "rgba(0, 255, 0, 0.9)" : baseColor,
        label: [
          portPoint.portPointId,
          `offBoard: ${portPoint.offBoardConnectionIds.join(", ")}`,
          `z: ${portPoint.availableZ.join(",")}`,
          isLast ? "<<< LAST CREATED >>>" : "",
        ]
          .filter(Boolean)
          .join("\n"),
      })
    }

    // Draw pending fragments (dimmed) if in creating_fragments phase
    if (this.phase === "creating_fragments") {
      for (
        let i = this.currentFragmentIndex;
        i < this.pendingFragments.length;
        i++
      ) {
        const pending = this.pendingFragments[i]
        const isNext = i === this.currentFragmentIndex
        const baseColor = this.offBoardColorMap[pending.offBoardId]

        graphics.lines!.push({
          points: [
            { x: pending.pp1.x, y: pending.pp1.y },
            { x: pending.pp2.x, y: pending.pp2.y },
          ],
          strokeColor: isNext
            ? "rgba(0, 255, 0, 0.8)"
            : safeTransparentize(baseColor, 0.7),
          label: isNext
            ? `>>> NEXT: ${pending.offBoardId} <<<`
            : `pending: ${pending.offBoardId}`,
        })
      }
    }

    // Draw all created path fragments with colors from offBoardConnectionId
    for (const fragment of this.pathFragments) {
      const isLast =
        this.lastCreatedFragment?.pathFragmentId === fragment.pathFragmentId
      const baseColor = this.offBoardColorMap[fragment.offBoardConnectionId]

      graphics.lines!.push({
        points: [fragment.start, fragment.end],
        strokeColor: isLast ? "rgba(0, 255, 0, 0.9)" : baseColor,
        label: [
          fragment.pathFragmentId,
          fragment.offBoardConnectionId,
          isLast ? "<<< LAST CREATED >>>" : "",
        ]
          .filter(Boolean)
          .join("\n"),
      })
    }

    // Draw phase indicator as a point at top-left
    const bounds = this.srj.bounds
    graphics.points!.push({
      x: bounds.minX,
      y: bounds.maxY,
      label: [
        `Phase: ${this.phase}`,
        `Obstacles: ${this.currentObstacleIndex}/${this.offboardObstacles.length}`,
        `Fragments: ${this.currentFragmentIndex}/${this.pendingFragments.length}`,
        `Port Points: ${this.portPoints.length}`,
        `Path Fragments: ${this.pathFragments.length}`,
      ].join("\n"),
      color: "rgba(0, 0, 0, 0.8)",
    })

    return graphics
  }
}
