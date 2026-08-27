import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { SimpleRouteJson } from "lib/types"
import fixtureJson from "../../fixtures/bug-reports/cm5-connector-terminal-escape/cm5-connector-terminal-escape-faithful.srj.json" with {
  type: "json",
}

type PathingSolverParamsView = {
  params: {
    connections: Array<{
      connectionId: string
      simpleRouteConnection?: {
        pointsToConnect: Array<{ pcb_port_id?: string }>
      }
      startRegion: {
        ports: Array<{
          d: { cramped?: boolean; x: number; y: number }
        }>
      }
    }>
  }
}

test("routes FAN_PWM outboard with the faithful narrow-gap CM5 connector", () => {
  const inputSrj = fixtureJson as SimpleRouteJson
  const connectorObstacles = inputSrj.obstacles.filter(
    (obstacle) => obstacle.componentId === "pcb_component_1",
  )
  const fanPad = connectorObstacles.find(
    (obstacle) => obstacle.circuitJsonMetadata?.pcb_port_id === "pcb_port_118",
  )!

  expect(inputSrj.connections).toHaveLength(5)
  expect(inputSrj.obstacles).toHaveLength(106)
  expect(connectorObstacles).toHaveLength(100)
  expect(fanPad).toMatchObject({
    obstacleRole: "pad",
    center: { x: 2.0300020000000703, y: -6.200013000000126 },
  })
  expect(fanPad.connectedTo).toEqual(
    expect.arrayContaining(["source_net_10", "pcb_port_118"]),
  )
  expect(
    connectorObstacles.filter(
      (obstacle) =>
        Math.abs(obstacle.center.x - fanPad.center.x) < 0.001 &&
        Math.abs(obstacle.center.y - fanPad.center.y) <= 0.41,
    ),
  ).toHaveLength(3)

  const pipeline = new AutoroutingPipelineSolver7_MultiGraph(
    structuredClone(inputSrj),
    {
      cacheProvider: null,
      effort: 1,
      postPowerDrcRepair: { enabled: false },
    },
  )
  pipeline.solveUntilPhase("uniformPortDistributionSolver")

  expect(pipeline.failed).toBe(false)
  const pathingSolver = pipeline.portPointPathingSolver!
  const pathingSolverParams = (
    pathingSolver as unknown as PathingSolverParamsView
  ).params
  const fanPointPair = pathingSolverParams.connections.find(
    (connection) => connection.connectionId === "source_net_10_mst1",
  )!
  expect(
    fanPointPair.simpleRouteConnection?.pointsToConnect[0]?.pcb_port_id,
  ).toBe("pcb_port_118")
  expect(fanPointPair.startRegion.ports).toHaveLength(4)
  expect(
    fanPointPair.startRegion.ports.every((port) => port.d.cramped === true),
  ).toBe(true)

  const portPoints = pathingSolver
    .getOutput()
    .nodesWithPortPoints.flatMap((node) => node.portPoints)
  const portPointById = new Map(
    portPoints.map((portPoint) => [portPoint.portPointId, portPoint]),
  )
  const fanTerminal = portPoints.find(
    (portPoint) => portPoint.pcb_port_id === "pcb_port_118",
  )!
  const terminalPath = []
  let currentPortPoint: (typeof portPoints)[number] | undefined = fanTerminal
  const visitedPortPointIds = new Set<string>()
  while (
    currentPortPoint &&
    !visitedPortPointIds.has(currentPortPoint.portPointId!) &&
    terminalPath.length < 8
  ) {
    visitedPortPointIds.add(currentPortPoint.portPointId!)
    terminalPath.push(currentPortPoint)
    currentPortPoint = currentPortPoint.nextPortPointId
      ? portPointById.get(currentPortPoint.nextPortPointId)
      : undefined
  }

  const firstLateralExit = terminalPath.find(
    (portPoint) => Math.abs(portPoint.x - fanTerminal.x) > 0.2,
  )!
  expect(firstLateralExit).toBeDefined()
  expect(firstLateralExit.x).toBeCloseTo(2.380001, 6)
  expect(firstLateralExit.x).toBeGreaterThan(fanTerminal.x)
})
