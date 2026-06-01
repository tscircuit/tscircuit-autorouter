import { BasePipelineSolver, definePipelineStep } from "@tscircuit/solver-utils"
import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import type { GraphicsObject } from "graphics-debug"
import { HighDensityForceImproveSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import { TraceSimplificationSolver } from "lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"
import type { SimpleRouteConnection } from "lib/types"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import { combineVisualizations } from "lib/utils/combineVisualizations"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import json from "./broken-trace-segment.json"
export { json }

type BrokenTraceSegmentInput = {
  nodeWithPortPoints: NodeWithPortPoints[]
  inputNodesWithPortPoints: NodeWithPortPoints[]
  minTraceWidth: number
  obstacles: Obstacle[]
  layerCount: number
}

const getGraphicsPrimitiveCount = (
  graphics: GraphicsObject | null | undefined,
) =>
  (graphics?.points?.length ?? 0) +
  (graphics?.lines?.length ?? 0) +
  (graphics?.rects?.length ?? 0) +
  (graphics?.circles?.length ?? 0) +
  (graphics?.arrows?.length ?? 0) +
  (graphics?.texts?.length ?? 0) +
  (graphics?.polygons?.length ?? 0) +
  (graphics?.infiniteLines?.length ?? 0)

const assertNonEmptyVisualization = (
  label: string,
  graphics: GraphicsObject | null | undefined,
) => {
  const primitiveCount = getGraphicsPrimitiveCount(graphics)

  console.assert(
    primitiveCount > 0,
    `${label} returned an empty visualization`,
    graphics,
  )

  return graphics ?? {}
}

const setGraphicsStep = (graphics: GraphicsObject, step: number) => ({
  ...graphics,
  lines: graphics.lines?.map((line) => ({ ...line, step })),
  points: graphics.points?.map((point) => ({ ...point, step })),
  circles: graphics.circles?.map((circle) => ({ ...circle, step })),
  rects: graphics.rects?.map((rect) => ({ ...rect, step })),
})

const getPathValue = (root: any, path: string) => {
  if (!path.startsWith("$.")) {
    throw new Error(`Unsupported ref path: ${path}`)
  }

  const parts = path
    .slice(2)
    .match(/[^[.\]]+|\[(\d+)\]/g)
    ?.map((part) => (part.startsWith("[") ? Number(part.slice(1, -1)) : part))

  return parts?.reduce((value, part) => value?.[part], root)
}

const resolveJsonRefs = <T,>(input: T): T => {
  const root = structuredClone(input)
  const seen = new WeakMap<object, any>()

  const resolve = (value: any): any => {
    if (value === null || typeof value !== "object") return value

    if (!Array.isArray(value) && typeof value.$ref === "string") {
      const resolvedRef = resolve(getPathValue(root, value.$ref))
      const entriesWithoutRef = Object.entries(value).filter(
        ([key]) => key !== "$ref",
      )

      if (entriesWithoutRef.length === 0) return resolvedRef

      return {
        ...(resolvedRef && typeof resolvedRef === "object" ? resolvedRef : {}),
        ...Object.fromEntries(
          entriesWithoutRef.map(([key, childValue]) => [
            key,
            resolve(childValue),
          ]),
        ),
      }
    }

    const cached = seen.get(value)
    if (cached) return cached

    const output: any = Array.isArray(value) ? [] : {}
    seen.set(value, output)

    for (const [key, childValue] of Object.entries(value)) {
      output[key] = resolve(childValue)
    }

    return output
  }

  return resolve(root)
}

const assertHydratedInput = (input: BrokenTraceSegmentInput) => {
  console.assert(
    input.nodeWithPortPoints.length > 0,
    "BrokenTraceSegment fixture has no nodeWithPortPoints",
    input,
  )
  console.assert(
    input.obstacles.length > 0,
    "BrokenTraceSegment fixture has no obstacles",
    input,
  )
  console.assert(
    input.obstacles.every((obstacle) => Array.isArray(obstacle.layers)),
    "BrokenTraceSegment fixture contains unhydrated obstacle.layers",
    input.obstacles.filter((obstacle) => !Array.isArray(obstacle.layers)),
  )
  console.assert(
    input.nodeWithPortPoints.every((node) => Array.isArray(node.portPoints)),
    "BrokenTraceSegment fixture contains a node without portPoints",
    input.nodeWithPortPoints.filter((node) => !Array.isArray(node.portPoints)),
  )
  console.assert(
    input.nodeWithPortPoints.every((node) =>
      node.portPoints.every(
        (portPoint) =>
          Number.isFinite(portPoint.x) && Number.isFinite(portPoint.y),
      ),
    ),
    "BrokenTraceSegment fixture contains port points without numeric x/y",
    input.nodeWithPortPoints.flatMap((node) =>
      node.portPoints.filter(
        (portPoint) =>
          !Number.isFinite(portPoint.x) || !Number.isFinite(portPoint.y),
      ),
    ),
  )
}

const getConnectionColor = (connectionName: string) => {
  let hash = 0
  for (const char of connectionName) {
    hash = (hash * 31 + char.charCodeAt(0)) % 360
  }
  return `hsl(${hash}, 85%, 45%)`
}

const getLayerNameForZ = (z: number) => (z === 0 ? "top" : "bottom")

const getFixtureConnections = (
  input: BrokenTraceSegmentInput,
): SimpleRouteConnection[] => {
  const portPoints = input.nodeWithPortPoints.flatMap((node) =>
    (node.portPointsInPairs ?? []).flat(),
  )
  const connectionNames = Array.from(
    new Set(portPoints.map((portPoint) => portPoint.connectionName)),
  )

  return connectionNames.flatMap((connectionName) => {
    const start =
      portPoints.find(
        (portPoint) =>
          portPoint.connectionName === connectionName &&
          portPoint.portPointId.includes("tiny-terminal:start-port"),
      ) ??
      portPoints.find(
        (portPoint) =>
          portPoint.connectionName === connectionName &&
          !portPoint.prevPortPointId,
      )
    const end =
      portPoints.find(
        (portPoint) =>
          portPoint.connectionName === connectionName &&
          portPoint.portPointId.includes("tiny-terminal:end-port"),
      ) ??
      portPoints.find(
        (portPoint) =>
          portPoint.connectionName === connectionName &&
          !portPoint.nextPortPointId,
      )

    if (!start || !end) return []

    return [
      {
        name: connectionName,
        rootConnectionName: start.rootConnectionName ?? connectionName,
        pointsToConnect: [
          {
            x: start.x,
            y: start.y,
            layer: getLayerNameForZ(start.z),
            pointId: start.portPointId,
          },
          {
            x: end.x,
            y: end.y,
            layer: getLayerNameForZ(end.z),
            pointId: end.portPointId,
          },
        ],
      },
    ]
  })
}

const getFixtureSimpleRouteJson = (input: BrokenTraceSegmentInput) =>
  ({
    connections: getFixtureConnections(input),
    obstacles: input.obstacles,
    layerCount: input.layerCount,
    minTraceWidth: input.minTraceWidth,
  }) as any

const getInputBounds = ({
  nodes,
  obstacles,
}: {
  nodes: NodeWithPortPoints[]
  obstacles: Obstacle[]
}) => {
  const xs = [
    ...obstacles.flatMap((obstacle) => [
      obstacle.center.x - obstacle.width / 2,
      obstacle.center.x + obstacle.width / 2,
    ]),
    ...nodes.flatMap((node) => [
      node.center.x - node.width / 2,
      node.center.x + node.width / 2,
      ...node.portPoints.map((portPoint) => portPoint.x),
    ]),
  ]
  const ys = [
    ...obstacles.flatMap((obstacle) => [
      obstacle.center.y - obstacle.height / 2,
      obstacle.center.y + obstacle.height / 2,
    ]),
    ...nodes.flatMap((node) => [
      node.center.y - node.height / 2,
      node.center.y + node.height / 2,
      ...node.portPoints.map((portPoint) => portPoint.y),
    ]),
  ]

  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  }
}

const getNodeObstacleVisualization = ({
  title,
  nodes,
  obstacles = [],
}: {
  title: string
  nodes: NodeWithPortPoints[]
  obstacles?: Obstacle[]
}): GraphicsObject => ({
  title,
  rects: [
    ...obstacles.map((obstacle) => ({
      center: obstacle.center,
      width: obstacle.width,
      height: obstacle.height,
      fill: obstacle.layers.includes("top")
        ? "rgba(239, 68, 68, 0.16)"
        : "rgba(37, 99, 235, 0.16)",
      stroke: obstacle.layers.includes("top")
        ? "rgba(239, 68, 68, 0.35)"
        : "rgba(37, 99, 235, 0.35)",
      layer: obstacle.layers.join(","),
      label: obstacle.obstacleId ?? "obstacle",
    })),
    ...nodes.map((node) => ({
      center: node.center,
      width: node.width,
      height: node.height,
      fill: "rgba(20, 184, 166, 0.06)",
      stroke: "rgba(20, 184, 166, 0.55)",
      layer: "capacity nodes",
      label: node.capacityMeshNodeId,
    })),
  ],
  points: nodes.flatMap((node) =>
    node.portPoints.map((portPoint) => ({
      x: portPoint.x,
      y: portPoint.y,
      color: getConnectionColor(portPoint.connectionName),
      layer: `z${portPoint.z}`,
      label: [
        portPoint.connectionName,
        portPoint.rootConnectionName,
        portPoint.portPointId,
      ]
        .filter(Boolean)
        .join("\n"),
    })),
  ),
  lines: [
    (() => {
      const bounds = getInputBounds({ nodes, obstacles })
      const margin = 0.5

      return {
        points: [
          { x: bounds.minX - margin, y: bounds.minY - margin },
          { x: bounds.maxX + margin, y: bounds.minY - margin },
          { x: bounds.maxX + margin, y: bounds.maxY + margin },
          { x: bounds.minX - margin, y: bounds.maxY + margin },
          { x: bounds.minX - margin, y: bounds.minY - margin },
        ],
        strokeColor: "rgba(15, 23, 42, 0.65)",
        strokeWidth: 0.04,
        layer: "bounds",
        label: `${title} bounds`,
      }
    })(),
    ...nodes.flatMap((node) =>
      (node.portPointsInPairs ?? []).map(([start, end]) => ({
        points: [
          { x: start.x, y: start.y },
          { x: end.x, y: end.y },
        ],
        strokeColor: getConnectionColor(start.connectionName),
        strokeDash: "4, 4",
        layer: `z${start.z}`,
        label: start.connectionName,
      })),
    ),
  ],
  circles: [],
})

const getInputVisualization = (input: BrokenTraceSegmentInput) =>
  assertNonEmptyVisualization(
    "BrokenTraceSegment input",
    getNodeObstacleVisualization({
      title: "Broken trace segment input",
      nodes: input.nodeWithPortPoints,
      obstacles: input.obstacles,
    }),
  )

const getRouteVisualization = ({
  title,
  routes,
}: {
  title: string
  routes: HighDensityRoute[]
}): GraphicsObject => ({
  title,
  lines: routes.flatMap((route) =>
    route.route.slice(0, -1).flatMap((point, index) => {
      const nextPoint = route.route[index + 1]

      if (!nextPoint || point.z !== nextPoint.z) return []

      return [
        {
          points: [
            { x: point.x, y: point.y },
            { x: nextPoint.x, y: nextPoint.y },
          ],
          strokeColor: getConnectionColor(route.connectionName),
          strokeWidth: route.traceThickness,
          layer: `z${point.z}`,
          label: route.connectionName,
        },
      ]
    }),
  ),
  points: routes.flatMap((route) =>
    route.route.map((point) => ({
      x: point.x,
      y: point.y,
      color: getConnectionColor(route.connectionName),
      layer: `z${point.z}`,
      label: route.connectionName,
    })),
  ),
  circles: routes.flatMap((route) =>
    route.vias.map((via) => ({
      center: via,
      radius: route.viaDiameter / 2,
      fill: getConnectionColor(route.connectionName),
      layer: "z0,1",
      label: `${route.connectionName}\nvia`,
    })),
  ),
  rects: [],
})

class BrokenTraceSegmentHighDensitySolver extends HighDensitySolver {
  _setupDone = true
  setup() {}
  _setup() {}

  getOutput() {
    return this.routes
  }

  override visualize(): GraphicsObject {
    return assertNonEmptyVisualization(
      "highDensityRouteSolver",
      combineVisualizations(
        getNodeObstacleVisualization({
          title: "High density route solver input",
          nodes: this.unsolvedNodePortPoints,
          obstacles: this.obstacles,
        }),
        super.visualize(),
      ),
    )
  }
}

class BrokenTraceSegmentForceImproveSolver extends HighDensityForceImproveSolver {
  _setupDone = true
  visualizationNodes: NodeWithPortPoints[]

  constructor(
    params: ConstructorParameters<typeof HighDensityForceImproveSolver>[0],
  ) {
    super(params)
    this.visualizationNodes = params.nodeWithPortPoints
  }

  setup() {}
  _setup() {}

  override visualize(): GraphicsObject {
    return assertNonEmptyVisualization(
      "highDensityForceImproveSolver",
      combineVisualizations(
        getNodeObstacleVisualization({
          title: "High density force improvement input",
          nodes: this.visualizationNodes,
        }),
        super.visualize(),
      ),
    )
  }
}

class BrokenTraceSegmentRepairSolver extends Pipeline4HighDensityRepairSolver {
  _setupDone = true
  setup() {}
  _setup() {}

  override visualize(): GraphicsObject {
    return assertNonEmptyVisualization(
      "highDensityRepairSolver",
      combineVisualizations(
        getNodeObstacleVisualization({
          title: "High density repair input",
          nodes: this.originalNodeWithPortPoints,
          obstacles: this.originalObstacles,
        }),
        super.visualize(),
      ),
    )
  }
}

class BrokenTraceSegmentStitchSolver extends MultipleHighDensityRouteStitchSolver3 {
  getOutput() {
    return this.mergedHdRoutes
  }
}

class BrokenTraceSegmentTraceSimplificationSolver extends TraceSimplificationSolver {
  getOutput() {
    return this.simplifiedHdRoutes
  }
}

/**
 * ref: lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph.ts
 */
export class BrokenTraceSegment extends BasePipelineSolver<BrokenTraceSegmentInput> {
  highDensityRouteSolver?: BrokenTraceSegmentHighDensitySolver
  highDensityForceImproveSolver?: BrokenTraceSegmentForceImproveSolver
  highDensityRepairSolver?: BrokenTraceSegmentRepairSolver
  highDensityStitchSolver?: BrokenTraceSegmentStitchSolver
  traceSimplificationSolver?: BrokenTraceSegmentTraceSimplificationSolver

  pipelineDef: ReturnType<typeof definePipelineStep>[] = [
    definePipelineStep(
      "highDensityRouteSolver",
      BrokenTraceSegmentHighDensitySolver as any,
      (solver: BrokenTraceSegment) => [
        {
          nodePortPoints: structuredClone(
            solver.inputProblem.nodeWithPortPoints,
          ),
          traceWidth: solver.inputProblem.minTraceWidth,
          obstacles: solver.inputProblem.obstacles,
          layerCount: solver.inputProblem.layerCount,
          useGrowShrinkHighDensityIntraNodeSolver: true,
          growShrinkMaxInnerIterationsPerGrowthAttempt: 8_000,
          growShrinkFallbackToInvalidGeometryOnFailure: true,
        },
      ],
    ),
    definePipelineStep(
      "highDensityForceImproveSolver",
      BrokenTraceSegmentForceImproveSolver as any,
      (solver: BrokenTraceSegment) => [
        {
          nodeWithPortPoints: structuredClone(
            solver.inputProblem.nodeWithPortPoints,
          ),
          hdRoutes: solver.highDensityRouteSolver!.routes,
          totalStepsPerNode: 20,
          nodeAssignmentMargin: 0.2,
        },
      ],
    ),
    definePipelineStep(
      "highDensityRepairSolver",
      BrokenTraceSegmentRepairSolver as any,
      (solver: BrokenTraceSegment) => [
        {
          nodeWithPortPoints: structuredClone(
            solver.inputProblem.nodeWithPortPoints,
          ),
          hdRoutes: solver.highDensityForceImproveSolver!.getOutput(),
          obstacles: solver.inputProblem.obstacles,
          repairMargin: 0.2,
        },
      ],
    ),
    definePipelineStep(
      "highDensityStitchSolver",
      BrokenTraceSegmentStitchSolver as any,
      (solver: BrokenTraceSegment) => [
        {
          connections: getFixtureConnections(solver.inputProblem),
          hdRoutes:
            solver.highDensityRepairSolver?.getOutput() ??
            solver.highDensityForceImproveSolver?.getOutput() ??
            solver.highDensityRouteSolver!.routes,
          layerCount: solver.inputProblem.layerCount,
          defaultViaDiameter: 0.3,
        },
      ],
    ),
    definePipelineStep(
      "traceSimplificationSolver",
      BrokenTraceSegmentTraceSimplificationSolver as any,
      (solver: BrokenTraceSegment) => {
        const simpleRouteJson = getFixtureSimpleRouteJson(solver.inputProblem)

        return [
          {
            hdRoutes: solver.highDensityStitchSolver!.mergedHdRoutes,
            obstacles: solver.inputProblem.obstacles,
            connMap: getConnectivityMapFromSimpleRouteJson(simpleRouteJson),
            colorMap: {},
            defaultViaDiameter: 0.3,
            layerCount: solver.inputProblem.layerCount,
            minTraceToPadEdgeClearance: 0.15,
          },
        ]
      },
    ),
  ]

  override getConstructorParams() {
    return [this.inputProblem] as const
  }

  override getOutput() {
    return (
      this.traceSimplificationSolver?.simplifiedHdRoutes ??
      this.highDensityStitchSolver?.mergedHdRoutes ??
      this.highDensityRepairSolver?.getOutput() ??
      this.highDensityForceImproveSolver?.getOutput() ??
      this.highDensityRouteSolver?.routes ??
      []
    )
  }

  override initialVisualize() {
    return assertNonEmptyVisualization(
      "BrokenTraceSegment initialVisualize",
      getInputVisualization(this.inputProblem),
    )
  }

  override finalVisualize() {
    const lastStageVisualization =
      this.traceSimplificationSolver?.visualize() ??
      this.highDensityStitchSolver?.visualize() ??
      this.highDensityRepairSolver?.visualize() ??
      this.highDensityForceImproveSolver?.visualize() ??
      this.highDensityRouteSolver?.visualize() ??
      {}

    return assertNonEmptyVisualization(
      "BrokenTraceSegment finalVisualize",
      setGraphicsStep(lastStageVisualization, 0),
    )
  }

  override visualize(): GraphicsObject {
    if (this.solved) {
      return this.finalVisualize()
    }

    const stageVisualizations = this.pipelineDef
      .map((stage) => {
        const stageVisualization = (this as any)[stage.solverName]?.visualize()

        if (stageVisualization) {
          assertNonEmptyVisualization(stage.solverName, stageVisualization)
        }

        return stageVisualization
      })
      .filter(Boolean) as GraphicsObject[]
    const activeVisualization = this.activeSubSolver?.visualize()

    if (activeVisualization) {
      assertNonEmptyVisualization(
        `${this.getCurrentStageName()} active solver`,
        activeVisualization,
      )
    }

    return assertNonEmptyVisualization(
      "BrokenTraceSegment pipeline visualize",
      combineVisualizations(
        getInputVisualization(this.inputProblem),
        ...stageVisualizations,
        activeVisualization ?? {},
      ),
    )
  }
}

export const brokenTraceSegmentInput = resolveJsonRefs(
  json[0],
) as BrokenTraceSegmentInput

const main = () => {
  const input = brokenTraceSegmentInput
  assertHydratedInput(input)
  assertNonEmptyVisualization(
    "BrokenTraceSegment fixture startup",
    getInputVisualization(input),
  )

  return (
    <GenericSolverDebugger createSolver={() => new BrokenTraceSegment(input)} />
  )
}

export default main
