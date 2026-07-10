import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { LengthMatchingSolver } from "lib/solvers/LengthMatchingSolver/LengthMatchingSolver"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"

type PadSpec = {
  id: string
  x: number
  y: number
  connectionName: string
}

function createGridPad(spec: PadSpec): Obstacle {
  return {
    obstacleId: spec.id,
    type: "rect",
    layers: ["top"],
    center: { x: spec.x, y: spec.y },
    width: 1.5,
    height: 1.5,
    connectedTo: [spec.connectionName],
  }
}

function createLengthMatchingGridSrj(): SimpleRouteJson {
  const pads: PadSpec[] = [
    { id: "left-top", x: 0, y: 2, connectionName: "data_p" },
    { id: "right-top", x: 20, y: 2, connectionName: "data_p" },
    { id: "left-bottom", x: 0, y: -2, connectionName: "data_n" },
    { id: "right-bottom", x: 22, y: -2, connectionName: "data_n" },
  ]

  return {
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaDiameter: 0.6,
    obstacles: pads.map(createGridPad),
    connections: [
      {
        name: "data_p",
        pointsToConnect: [
          { x: 0, y: 2, layer: "top", pcb_port_id: "left-top" },
          { x: 20, y: 2, layer: "top", pcb_port_id: "right-top" },
        ],
      },
      {
        name: "data_n",
        pointsToConnect: [
          { x: 0, y: -2, layer: "top", pcb_port_id: "left-bottom" },
          { x: 22, y: -2, layer: "top", pcb_port_id: "right-bottom" },
        ],
      },
    ],
    differentialPairs: [
      {
        connectionNames: ["data_p", "data_n"],
        lengthTolerance: 0.1,
      },
    ],
    bounds: { minX: -3, maxX: 25, minY: -5, maxY: 5 },
  }
}

test("Pipeline 7 exposes a post-simplification length-matching stage", () => {
  const srj = createLengthMatchingGridSrj()
  const solver = new AutoroutingPipelineSolver7_MultiGraph(srj)
  const stageNames = solver.pipelineDef.map((step) => step.solverName)

  expect(stageNames).toContain("lengthMatchingSolver")
  expect(stageNames.indexOf("lengthMatchingSolver")).toBe(
    stageNames.indexOf("traceSimplificationSolver") + 1,
  )

  const lengthMatchingSolver = new LengthMatchingSolver({
    hdRoutes: [],
    originalConnections: srj.connections,
    differentialPairs: srj.differentialPairs,
  })
  lengthMatchingSolver.solve()
  expect(lengthMatchingSolver.matchedHdRoutes).toEqual([])
  expect(lengthMatchingSolver.solved).toBe(true)

  const branchedConnection = {
    ...srj.connections[0]!,
    pointsToConnect: [
      ...srj.connections[0]!.pointsToConnect,
      { x: 10, y: 2, layer: "top" },
    ],
  }
  const invalidLengthMatchingSolver = new LengthMatchingSolver({
    hdRoutes: [],
    originalConnections: [branchedConnection, srj.connections[1]!],
    differentialPairs: srj.differentialPairs,
  })
  expect(() => invalidLengthMatchingSolver.solve()).toThrow(
    'differential pair connection "data_p" must have exactly two points before MST splitting',
  )
  expect(convertSrjToGraphicsObject(srj)).toMatchGraphicsSvg(import.meta.path)
})
