import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import fixtureJson from "../../fixtures/bug-reports/cm5-connector-terminal-escape/cm5-connector-terminal-escape.srj.json" with {
  type: "json",
}

type PathingSolverParamsView = {
  params: {
    connections: Array<{
      connectionId: string
      simpleRouteConnection?: {
        pointsToConnect: Array<{ pcb_port_id?: string }>
      }
      startRegion: { ports: Array<{ d: { x: number } }> }
    }>
  }
}

test("routes the CM5 connector escape outboard and captures through-via DRC residue", () => {
  const inputSrj = fixtureJson as SimpleRouteJson
  expect(inputSrj.connections).toHaveLength(5)
  expect(inputSrj.obstacles).toHaveLength(19)

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
  const portPoints = pathingSolver
    .getOutput()
    .nodesWithPortPoints.flatMap((node) => node.portPoints)
  const portPointById = new Map(
    portPoints.map((portPoint) => [portPoint.portPointId, portPoint]),
  )
  const fanTerminal = portPoints.find(
    (portPoint) => portPoint.pcb_port_id === "pcb_port_118",
  )!
  expect(fanTerminal).toBeDefined()

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

  const pathingSolverParams = (
    pathingSolver as unknown as PathingSolverParamsView
  ).params
  const fanPointPair = pathingSolverParams.connections.find(
    (connection) => connection.connectionId === "source_net_10_mst1",
  )!
  expect(
    fanPointPair.simpleRouteConnection?.pointsToConnect[0]?.pcb_port_id,
  ).toBe("pcb_port_118")
  expect(
    fanPointPair.startRegion.ports.some(
      (port) => port.d.x < fanTerminal.x - 0.2,
    ),
  ).toBe(true)
  expect(
    fanPointPair.startRegion.ports.some(
      (port) => port.d.x > fanTerminal.x + 0.2,
    ),
  ).toBe(true)

  const croppedTraces: SimplifiedPcbTrace[] = [
    {
      type: "pcb_trace",
      pcb_trace_id: "via_owner_0",
      connection_name: "via_owner",
      route: [
        {
          route_type: "wire",
          x: -0.12953984076621877,
          y: 8.370791466681467,
          width: 0.15,
          layer: "inner1",
        },
        {
          route_type: "wire",
          x: -0.13678709575453765,
          y: 8.350283635547136,
          width: 0.15,
          layer: "inner1",
        },
        {
          route_type: "via",
          x: -0.13678709575453765,
          y: 8.350283635547136,
          from_layer: "inner1",
          to_layer: "top",
        },
        {
          route_type: "wire",
          x: -0.13678709575453765,
          y: 8.350283635547136,
          width: 0.15,
          layer: "top",
        },
        {
          route_type: "wire",
          x: -0.22241362308551224,
          y: 8.238066300574733,
          width: 0.15,
          layer: "top",
        },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "bottom_crossing_0",
      connection_name: "bottom_crossing",
      route: [
        {
          route_type: "wire",
          x: 0.1335090121995461,
          y: 8.416295213835097,
          width: 0.15,
          layer: "bottom",
        },
        {
          route_type: "wire",
          x: 0.18779637304705224,
          y: 8.117093572165212,
          width: 0.15,
          layer: "bottom",
        },
      ],
    },
  ]
  const drcSrj: SimpleRouteJson = {
    bounds: { minX: -1, maxX: 1, minY: 7, maxY: 10 },
    layerCount: 4,
    minTraceWidth: 0.15,
    minViaDiameter: 0.3,
    minViaHoleDiameter: 0.2,
    obstacles: [],
    connections: [
      {
        name: "via_owner",
        pointsToConnect: [
          {
            x: -0.12953984076621877,
            y: 8.370791466681467,
            layer: "inner1",
          },
          {
            x: -0.22241362308551224,
            y: 8.238066300574733,
            layer: "top",
          },
        ],
      },
      {
        name: "bottom_crossing",
        pointsToConnect: [
          {
            x: 0.1335090121995461,
            y: 8.416295213835097,
            layer: "bottom",
          },
          {
            x: 0.18779637304705224,
            y: 8.117093572165212,
            layer: "bottom",
          },
        ],
      },
    ],
  }
  const throughViaSrj = {
    ...drcSrj,
    allowBlindAndBuriedVias: false,
  }
  const blindViaSrj = {
    ...drcSrj,
    allowBlindAndBuriedVias: true,
  }
  const throughViaResult = evaluateRelaxedDrc({
    inputSrj: throughViaSrj,
    srjWithPointPairs: throughViaSrj,
    routedTraces: croppedTraces,
    drcOptions: { includeBoardEdge: false, includeTraceContinuity: false },
  })
  const blindViaResult = evaluateRelaxedDrc({
    inputSrj: blindViaSrj,
    srjWithPointPairs: blindViaSrj,
    routedTraces: croppedTraces,
    drcOptions: { includeBoardEdge: false, includeTraceContinuity: false },
  })

  expect(throughViaResult.errors).toHaveLength(1)
  expect(throughViaResult.errors[0]).toMatchObject({
    type: "pcb_via_trace_clearance_error",
    pcb_via_trace_clearance_error_id:
      "via_trace_clearance_via_0_bottom_crossing_0",
    actual_clearance: 0.05273863512580461,
  })
  expect(
    throughViaResult.circuitJson.find((element) => element.type === "pcb_via"),
  ).toMatchObject({ layers: ["top", "inner1", "inner2", "bottom"] })
  expect(blindViaResult.errors).toHaveLength(0)
  expect(
    blindViaResult.circuitJson.find((element) => element.type === "pcb_via"),
  ).toMatchObject({ layers: ["top", "inner1"] })
})
