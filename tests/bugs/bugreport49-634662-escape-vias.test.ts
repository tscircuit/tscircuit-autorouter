import { expect, test } from "bun:test"
import { distance, pointToBoxDistance } from "@tscircuit/math-utils"
import bugReport from "../../fixtures/bug-reports/bugreport49-634662/bugreport49-634662.json" with {
  type: "json",
}
import { AutoroutingPipelineSolver } from "../../lib"
import { EscapeViaLocationSolver } from "../../lib/solvers/EscapeViaLocationSolver/EscapeViaLocationSolver"
import type { SimpleRouteJson } from "../../lib/types"
import { isPointInRect } from "../../lib/utils/isPointInRect"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport49 adds escape via points for copper pour nets", () => {
  const solver = new EscapeViaLocationSolver(srj)
  solver.solve()

  const output = solver.getOutputSimpleRouteJson()
  const metadataByPointId = solver.getEscapeViaMetadataByPointId()

  const vcc = output.connections.find(
    (connection) => connection.name === "source_net_0",
  )
  const gnd = output.connections.find(
    (connection) => connection.name === "source_net_1",
  )

  expect(vcc).toBeDefined()
  expect(gnd).toBeDefined()

  const vccEscapePoints =
    vcc?.pointsToConnect.filter((point) =>
      point.pointId?.startsWith("escape-via:"),
    ) ?? []
  const gndEscapePoints =
    gnd?.pointsToConnect.filter((point) =>
      point.pointId?.startsWith("escape-via:"),
    ) ?? []

  expect(vccEscapePoints).toHaveLength(4)
  expect(gndEscapePoints).toHaveLength(1)

  expect(
    vcc?.externallyConnectedPointIds?.some(
      (group) =>
        group.length === 4 &&
        group.every((pointId) => pointId.startsWith("escape-via:")),
    ),
  ).toBe(true)

  for (const point of [...vccEscapePoints, ...gndEscapePoints]) {
    expect("layer" in point ? point.layer : null).toBe("top")
    expect("terminalVia" in point ? point.terminalVia?.toLayer : null).toBe(
      point.pointId ? metadataByPointId.get(point.pointId)?.targetLayer : null,
    )

    const metadata = point.pointId
      ? metadataByPointId.get(point.pointId)
      : undefined
    expect(metadata).toBeDefined()

    const matchingPour = srj.obstacles.find(
      (obstacle) =>
        obstacle.isCopperPour &&
        obstacle.layers.includes(metadata!.targetLayer) &&
        isPointInRect(point, obstacle),
    )
    expect(matchingPour).toBeDefined()

    const topObstacleAtPoint = srj.obstacles.find(
      (obstacle) =>
        !obstacle.isCopperPour &&
        obstacle.layers.includes("top") &&
        isPointInRect(point, obstacle),
    )
    expect(topObstacleAtPoint).toBeUndefined()
  }

  const requiredViaSpacing =
    (srj.minViaDiameter ?? 0.3) + (srj.defaultObstacleMargin ?? 0.15)
  const allEscapePoints = [...vccEscapePoints, ...gndEscapePoints]
  for (let i = 0; i < allEscapePoints.length; i++) {
    for (let j = i + 1; j < allEscapePoints.length; j++) {
      expect(
        distance(allEscapePoints[i]!, allEscapePoints[j]!),
      ).toBeGreaterThan(requiredViaSpacing - 1e-3)
    }
  }
})

test("escape via placement keeps same-obstacle vias separated using obstacle size", () => {
  const syntheticSrj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.15,
    minViaDiameter: 0.3,
    defaultObstacleMargin: 0.15,
    bounds: {
      minX: -10,
      maxX: 10,
      minY: -10,
      maxY: 10,
    },
    obstacles: [
      {
        obstacleId: "shared-pad",
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 1,
        height: 6,
        connectedTo: ["source_net_0", "pcb_port_a", "pcb_port_b"],
      },
      {
        obstacleId: "inner1-pour",
        type: "rect",
        layers: ["inner1"],
        center: { x: 0, y: 0 },
        width: 18,
        height: 18,
        connectedTo: ["source_net_0"],
        isCopperPour: true,
      },
    ],
    connections: [
      {
        name: "source_net_0",
        pointsToConnect: [
          {
            x: -0.4,
            y: -0.1,
            layer: "top",
            pointId: "pcb_port_a",
            pcb_port_id: "pcb_port_a",
          },
          {
            x: -0.4,
            y: 0.1,
            layer: "top",
            pointId: "pcb_port_b",
            pcb_port_id: "pcb_port_b",
          },
        ],
      },
    ],
  }

  const solver = new EscapeViaLocationSolver(syntheticSrj)
  solver.solve()

  const output = solver.getOutputSimpleRouteJson()
  const connection = output.connections.find(
    (candidateConnection) => candidateConnection.name === "source_net_0",
  )
  const escapePoints =
    connection?.pointsToConnect.filter((point) =>
      point.pointId?.startsWith("escape-via:"),
    ) ?? []

  expect(escapePoints).toHaveLength(2)

  const sourceObstacle = syntheticSrj.obstacles.find(
    (obstacle) => obstacle.obstacleId === "shared-pad",
  )!
  const viaRadius = (syntheticSrj.minViaDiameter ?? 0.3) / 2
  const expectedLeftX =
    sourceObstacle.center.x -
    sourceObstacle.width / 2 -
    (viaRadius +
      Math.max(
        syntheticSrj.minTraceWidth / 2,
        syntheticSrj.defaultObstacleMargin ?? 0.15,
      ))
  const requiredViaSpacing =
    (syntheticSrj.minViaDiameter ?? 0.3) +
    (syntheticSrj.defaultObstacleMargin ?? 0.15)

  expect(
    escapePoints.every((point) => Math.abs(point.x - expectedLeftX) < 1e-3),
  ).toBe(true)
  expect(distance(escapePoints[0]!, escapePoints[1]!)).toBeGreaterThan(
    requiredViaSpacing - 1e-3,
  )

  for (const point of escapePoints) {
    expect(isPointInRect(point, sourceObstacle)).toBe(false)
    expect(
      pointToBoxDistance(point, sourceObstacle) - viaRadius,
    ).toBeGreaterThan((syntheticSrj.defaultObstacleMargin ?? 0.15) - 1e-3)
  }
})

test("bugreport49 serializes VCC escape vias into the pour", () => {
  const solver = new AutoroutingPipelineSolver(srj)
  solver.solve()

  const traces = solver.getOutputSimplifiedPcbTraces()
  const vccTraces = traces.filter(
    (trace) => trace.connection_name === "net.VCC",
  )
  const gndTraces = traces.filter(
    (trace) => trace.connection_name === "net.GND",
  )

  expect(
    vccTraces.some((trace) =>
      trace.route.some(
        (segment) =>
          segment.route_type === "via" && segment.to_layer === "inner1",
      ),
    ),
  ).toBe(true)
  expect(
    gndTraces.some((trace) =>
      trace.route.some(
        (segment) =>
          segment.route_type === "via" && segment.to_layer === "inner2",
      ),
    ),
  ).toBe(true)
})
