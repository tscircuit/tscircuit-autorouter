import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "lib/solvers/BaseSolver"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"
import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import { generateColorMapFromNodeWithPortPoints } from "lib/utils/generateColorMapFromNodeWithPortPoints"
import { useState } from "react"

type GridPoint =
  | readonly [x: number, y: number]
  | readonly [x: number, y: number, z: number]

type GridPort = {
  at: GridPoint
  connectionName: string
  rootConnectionName?: string
}

type GridNode = {
  id: string
  rect: readonly [left: number, top: number, right: number, bottom: number]
  ports: GridPort[]
  portPointPairs?: Array<
    readonly [startPortIndex: number, endPortIndex: number]
  >
}

const gridPointToWorldPoint = ([x, y, z = 0]: GridPoint, pitch: number) => ({
  x: x * pitch,
  y: -y * pitch,
  z,
})

const createGridHighDensityProblem = ({
  nodes,
  pitch = 1,
}: {
  nodes: GridNode[]
  pitch?: number
}) => {
  const connMap = new ConnectivityMap({})
  const nodePortPoints: NodeWithPortPoints[] = nodes.map((node) => {
    const [left, top, right, bottom] = node.rect

    const portPoints: PortPoint[] = node.ports.map((port, portIndex) => {
      const portPointId = `${node.id}_pp${portIndex}`
      connMap.addConnections([[port.connectionName, portPointId]])
      if (port.rootConnectionName) {
        connMap.addConnections([[port.connectionName, port.rootConnectionName]])
      }

      return {
        ...gridPointToWorldPoint(port.at, pitch),
        connectionName: port.connectionName,
        rootConnectionName: port.rootConnectionName ?? port.connectionName,
        portPointId,
      }
    })

    const portPointsInPairs = node.portPointPairs?.map(
      ([startPortIndex, endPortIndex]) =>
        [portPoints[startPortIndex]!, portPoints[endPortIndex]!] as [
          PortPoint,
          PortPoint,
        ],
    )

    return {
      capacityMeshNodeId: node.id,
      center: {
        x: ((left + right) / 2) * pitch,
        y: -((top + bottom) / 2) * pitch,
      },
      width: Math.abs(right - left) * pitch,
      height: Math.abs(bottom - top) * pitch,
      portPoints,
      portPointsInPairs,
      availableZ: [0, 1],
    }
  })

  const colorMap: Record<string, string> = {}
  for (const node of nodePortPoints) {
    Object.assign(colorMap, generateColorMapFromNodeWithPortPoints(node))
  }

  return { nodePortPoints, colorMap, connMap }
}

const visualizeHighDensityInput = (
  nodePortPoints: NodeWithPortPoints[],
  colorMap: Record<string, string>,
): GraphicsObject => {
  const graphics: GraphicsObject = {
    lines: [],
    points: [],
    rects: [],
    circles: [],
  }

  for (const node of nodePortPoints) {
    const left = node.center.x - node.width / 2
    const right = node.center.x + node.width / 2
    const top = node.center.y - node.height / 2
    const bottom = node.center.y + node.height / 2

    graphics.lines!.push(
      {
        points: [
          { x: left, y: top },
          { x: right, y: top },
        ],
        strokeColor: "#525252",
        strokeWidth: 0.04,
        layer: "input_node_bounds",
        label: node.capacityMeshNodeId,
      },
      {
        points: [
          { x: right, y: top },
          { x: right, y: bottom },
        ],
        strokeColor: "#525252",
        strokeWidth: 0.04,
        layer: "input_node_bounds",
        label: node.capacityMeshNodeId,
      },
      {
        points: [
          { x: right, y: bottom },
          { x: left, y: bottom },
        ],
        strokeColor: "#525252",
        strokeWidth: 0.04,
        layer: "input_node_bounds",
        label: node.capacityMeshNodeId,
      },
      {
        points: [
          { x: left, y: bottom },
          { x: left, y: top },
        ],
        strokeColor: "#525252",
        strokeWidth: 0.04,
        layer: "input_node_bounds",
        label: node.capacityMeshNodeId,
      },
    )

    for (const portPoint of node.portPoints) {
      graphics.points!.push({
        x: portPoint.x,
        y: portPoint.y,
        color: colorMap[portPoint.connectionName] ?? "#2563eb",
        layer: "input_port_points",
        label: [
          portPoint.portPointId,
          portPoint.connectionName,
          `root: ${portPoint.rootConnectionName ?? portPoint.connectionName}`,
          `z: ${portPoint.z}`,
        ].join("\n"),
      })
    }

    for (const [startPortPoint, endPortPoint] of node.portPointsInPairs ?? []) {
      graphics.lines!.push({
        points: [
          { x: startPortPoint.x, y: startPortPoint.y },
          { x: endPortPoint.x, y: endPortPoint.y },
        ],
        strokeColor:
          colorMap[startPortPoint.connectionName] ??
          colorMap[endPortPoint.connectionName] ??
          "#16a34a",
        strokeWidth: 0.025,
        strokeDash: "4, 3",
        layer: "input_intended_port_pairs",
        label: [
          "intended pair",
          startPortPoint.connectionName,
          `root: ${startPortPoint.rootConnectionName ?? startPortPoint.connectionName}`,
        ].join("\n"),
      })
    }
  }

  return graphics
}

class HighDensitySolverWithInputVisualization extends BaseSolver {
  hdSolver: HighDensitySolver
  inputVisualization: GraphicsObject

  constructor({
    hdSolver,
    inputVisualization,
  }: {
    hdSolver: HighDensitySolver
    inputVisualization: GraphicsObject
  }) {
    super()
    this.hdSolver = hdSolver
    this.inputVisualization = inputVisualization
    this.MAX_ITERATIONS = hdSolver.MAX_ITERATIONS
  }

  override getSolverName() {
    return "HighDensitySolverWithInputVisualization"
  }

  override _step() {
    this.hdSolver.step()
    this.solved = this.hdSolver.solved
    this.failed = this.hdSolver.failed
    this.error = this.hdSolver.error
    this.progress = this.hdSolver.progress
    this.stats = this.hdSolver.stats
    this.activeSubSolver = this.hdSolver.activeSubSolver ?? this.hdSolver
    this.failedSubSolvers = this.hdSolver.failedSubSolvers
  }

  override visualize(): GraphicsObject {
    if (this.iterations === 0) return this.inputVisualization
    return this.hdSolver.visualize()
  }

  override preview(): GraphicsObject {
    return this.visualize()
  }
}

export const highDensityRouteSolverGridProblems = [
  {
    name: "Wrong Connection 01",
    createProblem: () =>
      createGridHighDensityProblem({
        nodes: [
          {
            id: "cmn_noncrossing",
            rect: [-2, -2, 2, 2],
            ports: [
              { at: [-2, 0], connectionName: "conn1" },
              { at: [0, 2], connectionName: "conn1" },
              { at: [0, -2], connectionName: "conn1" },
              { at: [2, 0], connectionName: "conn1" },
            ],
            portPointPairs: [
              [0, 1],
              [2, 3],
            ],
          },
        ],
      }),
  },
] as const

export const createHighDensityRouteSolverForProblem = (
  selectedProblem: (typeof highDensityRouteSolverGridProblems)[number],
) => {
  const problem = selectedProblem.createProblem()

  const hdSolver = new HighDensitySolver({
    nodePortPoints: problem.nodePortPoints,
    nodePfById: new Map(),
    colorMap: problem.colorMap,
    connMap: problem.connMap,
    viaDiameter: 0.3,
    traceWidth: 0.15,
    obstacleMargin: 0.15,
    obstacles: [],
    layerCount: 2,
    useGrowShrinkHighDensityIntraNodeSolver: true,
  })

  return new HighDensitySolverWithInputVisualization({
    hdSolver,
    inputVisualization: visualizeHighDensityInput(
      problem.nodePortPoints,
      problem.colorMap,
    ),
  })
}

const HighDensityRouteSolverFixture = () => {
  const [selectedProblemName, setSelectedProblemName] = useState<string>(
    highDensityRouteSolverGridProblems[0].name,
  )

  const selectedProblem =
    highDensityRouteSolverGridProblems.find(
      (gridProblem) => gridProblem.name === selectedProblemName,
    ) ?? highDensityRouteSolverGridProblems[0]

  const createSolver = () =>
    createHighDensityRouteSolverForProblem(selectedProblem)

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
        Problem
        <select
          value={selectedProblem.name}
          onChange={(event) =>
            setSelectedProblemName(event.currentTarget.value)
          }
        >
          {highDensityRouteSolverGridProblems.map((gridProblem) => (
            <option key={gridProblem.name} value={gridProblem.name}>
              {gridProblem.name}
            </option>
          ))}
        </select>
      </label>
      <GenericSolverDebugger
        key={selectedProblem.name}
        createSolver={createSolver as any}
      />
    </div>
  )
}

export const highDensityRouteSolver = HighDensityRouteSolverFixture

export default HighDensityRouteSolverFixture
