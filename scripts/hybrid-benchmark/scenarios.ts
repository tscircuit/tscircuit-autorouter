import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import type {
  ConnectionPoint,
  SimpleRouteConnection,
  SimpleRouteJson,
} from "../../lib/types"
import { loadScenarioBySampleNumber } from "../benchmark/scenarios"

export type HybridBenchmarkScenario = {
  readonly scenarioId: string
  readonly source: string
  readonly categories: readonly string[]
  readonly input: SimpleRouteJson
}

type Z04PortPoint = {
  readonly portPointId: string
  readonly x: number
  readonly y: number
  readonly z: number
  readonly connectionName: string
  readonly rootConnectionName?: string
}

type Z04Problem = {
  readonly capacityMeshNodeId: string
  readonly center: { readonly x: number; readonly y: number }
  readonly width: number
  readonly height: number
  readonly portPoints: readonly Z04PortPoint[]
  readonly availableZ: readonly number[]
}

export async function loadHybridBenchmarkScenarios(): Promise<
  readonly HybridBenchmarkScenario[]
> {
  const [srj18, srj23, srj27, srj28, highDensity] = await Promise.all([
    loadScenarioBySampleNumber("srj18", 3, 1),
    loadScenarioBySampleNumber("srj23", 49, 1),
    loadScenarioBySampleNumber("srj27", 5, 1),
    loadScenarioBySampleNumber("srj28", 36, 1),
    loadZ04Scenario(),
  ])
  return Object.freeze([
    createSimpleScenario(),
    createDifferentialPairScenario(),
    createPowerTreeScenario(),
    createLargeMultiRegionScenario(),
    Object.freeze({
      scenarioId: "srj18-sample003",
      source: srj18.sourceLabel,
      categories: Object.freeze(["srj18", "large-multi-region"]),
      input: srj18.scenario,
    }),
    Object.freeze({
      scenarioId: "srj23-circuit064",
      source: srj23.sourceLabel,
      categories: Object.freeze(["srj23", "preloaded-copper"]),
      input: srj23.scenario,
    }),
    Object.freeze({
      scenarioId: "srj27-sample005",
      source: srj27.sourceLabel,
      categories: Object.freeze(["power-routing", "preloaded-copper"]),
      input: srj27.scenario,
    }),
    Object.freeze({
      scenarioId: "srj28-circuit119",
      source: srj28.sourceLabel,
      categories: Object.freeze(["preloaded-copper"]),
      input: srj28.scenario,
    }),
    highDensity,
  ])
}

function createSimpleScenario(): HybridBenchmarkScenario {
  return Object.freeze({
    scenarioId: "simple-direct",
    source: "hybrid benchmark fixture",
    categories: Object.freeze(["simple"]),
    input: createBaseInput({
      bounds: { minX: -6, maxX: 6, minY: -3, maxY: 3 },
      connections: [createConnection("signal", -4, 0, 4, 0)],
    }),
  })
}

function createDifferentialPairScenario(): HybridBenchmarkScenario {
  const input = createBaseInput({
    bounds: { minX: -8, maxX: 8, minY: -4, maxY: 4 },
    connections: [
      createConnection("pair_positive", -6, -0.3, 6, -0.3),
      createConnection("pair_negative", -6, 0.3, 6, 0.3),
    ],
  })
  return Object.freeze({
    scenarioId: "differential-pair",
    source: "hybrid benchmark fixture",
    categories: Object.freeze(["differential-pair"]),
    input: Object.freeze({
      ...input,
      differentialPairs: [
        {
          connectionNames: ["pair_positive", "pair_negative"] as [
            string,
            string,
          ],
          lengthTolerance: 0.1,
          traceGap: 0.18,
          maxUncoupledLength: 1,
        },
      ],
    }),
  })
}

function createPowerTreeScenario(): HybridBenchmarkScenario {
  const branchPoints: ConnectionPoint[] = [
    {
      x: -6,
      y: 0,
      layer: "top",
      pointId: "power-left",
      pcb_port_id: "power-left",
    },
    {
      x: 6,
      y: -2,
      layer: "top",
      pointId: "power-lower-right",
      pcb_port_id: "power-lower-right",
    },
    {
      x: 6,
      y: 2,
      layer: "top",
      pointId: "power-upper-right",
      pcb_port_id: "power-upper-right",
    },
  ]
  return Object.freeze({
    scenarioId: "power-tree",
    source: "hybrid benchmark fixture",
    categories: Object.freeze(["power-routing"]),
    input: createBaseInput({
      bounds: { minX: -8, maxX: 8, minY: -5, maxY: 5 },
      connections: [
        {
          name: "power_vcc",
          nominalTraceWidth: 0.4,
          pointsToConnect: branchPoints,
        },
      ],
    }),
  })
}

function createLargeMultiRegionScenario(): HybridBenchmarkScenario {
  const connections = Array.from({ length: 24 }, (_, index) => {
    const y = -11.5 + index
    return createConnection(
      `multi_${String(index).padStart(2, "0")}`,
      -18,
      y,
      18,
      y,
    )
  })
  return Object.freeze({
    scenarioId: "large-multi-region",
    source: "hybrid benchmark fixture",
    categories: Object.freeze(["large-multi-region"]),
    input: createBaseInput({
      bounds: { minX: -20, maxX: 20, minY: -14, maxY: 14 },
      connections,
    }),
  })
}

function createBaseInput({
  bounds,
  connections,
}: {
  bounds: SimpleRouteJson["bounds"]
  connections: SimpleRouteConnection[]
}): SimpleRouteJson {
  const obstacles = connections.flatMap((connection) =>
    connection.pointsToConnect.map((point, pointIndex) => {
      const pcbPortId =
        point.pcb_port_id ?? `${connection.name}:port:${pointIndex}`
      return {
        obstacleId: `pad:${pcbPortId}`,
        type: "rect" as const,
        layers: "layer" in point ? [point.layer] : [...point.layers],
        center: { x: point.x, y: point.y },
        width: 0.3,
        height: 0.3,
        connectedTo: [connection.name, pcbPortId],
        circuitJsonMetadata: { pcb_port_id: pcbPortId },
      }
    }),
  )
  return {
    layerCount: 2,
    minTraceWidth: 0.15,
    nominalTraceWidth: 0.15,
    minViaHoleDiameter: 0.3,
    minViaPadDiameter: 0.6,
    defaultObstacleMargin: 0.15,
    minTraceToPadEdgeClearance: 0.15,
    minViaEdgeToPadEdgeClearance: 0.15,
    minBoardEdgeClearance: 0.15,
    bounds,
    obstacles,
    connections,
  }
}

function createConnection(
  name: string,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): SimpleRouteConnection {
  return {
    name,
    pointsToConnect: [
      {
        x: startX,
        y: startY,
        layer: "top",
        pointId: `${name}:start`,
        pcb_port_id: `${name}:start`,
      },
      {
        x: endX,
        y: endY,
        layer: "top",
        pointId: `${name}:end`,
        pcb_port_id: `${name}:end`,
      },
    ],
  }
}

async function loadZ04Scenario(): Promise<HybridBenchmarkScenario> {
  const filePath = resolve(
    "node_modules/high-density-dataset-z04/hg-problem/429.json",
  )
  const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"))
  const problem = parseZ04Problem(parsed)
  const pointsByConnection = new Map<string, Z04PortPoint[]>()
  for (const point of problem.portPoints) {
    const points = pointsByConnection.get(point.connectionName) ?? []
    points.push(point)
    pointsByConnection.set(point.connectionName, points)
  }
  const connections = [...pointsByConnection.entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([name, points]) => ({
      name,
      rootConnectionName: points[0]?.rootConnectionName,
      pointsToConnect: points.map((point) => ({
        x: point.x,
        y: point.y,
        layer: point.z === 0 ? "top" : "bottom",
        pointId: point.portPointId,
        pcb_port_id: point.portPointId,
      })),
    }))
  const boardMarginMm = 1.5
  return Object.freeze({
    scenarioId: "z04-region-429",
    source: `high-density-dataset-z04:${problem.capacityMeshNodeId}:429`,
    categories: Object.freeze(["high-density"]),
    input: createBaseInput({
      bounds: {
        minX: problem.center.x - problem.width / 2 - boardMarginMm,
        maxX: problem.center.x + problem.width / 2 + boardMarginMm,
        minY: problem.center.y - problem.height / 2 - boardMarginMm,
        maxY: problem.center.y + problem.height / 2 + boardMarginMm,
      },
      connections,
    }),
  })
}

function parseZ04Problem(value: unknown): Z04Problem {
  if (!isRecord(value)) throw new Error("Z04 problem must be an object")
  if (
    typeof value.capacityMeshNodeId !== "string" ||
    !isPoint(value.center) ||
    !isFinitePositive(value.width) ||
    !isFinitePositive(value.height) ||
    !Array.isArray(value.portPoints) ||
    !Array.isArray(value.availableZ)
  ) {
    throw new Error("Z04 problem has an invalid shape")
  }
  const portPoints = value.portPoints.map((point) => parseZ04PortPoint(point))
  const availableZ = value.availableZ.map((z) => {
    if (!Number.isSafeInteger(z) || (z !== 0 && z !== 1)) {
      throw new Error("Z04 availableZ must contain only layers 0 and 1")
    }
    return z
  })
  return Object.freeze({
    capacityMeshNodeId: value.capacityMeshNodeId,
    center: Object.freeze({ x: value.center.x, y: value.center.y }),
    width: value.width,
    height: value.height,
    portPoints: Object.freeze(portPoints),
    availableZ: Object.freeze(availableZ),
  })
}

function parseZ04PortPoint(value: unknown): Z04PortPoint {
  if (
    !isRecord(value) ||
    typeof value.portPointId !== "string" ||
    !isFiniteNumber(value.x) ||
    !isFiniteNumber(value.y) ||
    !isSafeInteger(value.z) ||
    typeof value.connectionName !== "string" ||
    (value.rootConnectionName !== undefined &&
      typeof value.rootConnectionName !== "string")
  ) {
    throw new Error("Z04 port point has an invalid shape")
  }
  return Object.freeze({
    portPointId: value.portPointId,
    x: value.x,
    y: value.y,
    z: value.z,
    connectionName: value.connectionName,
    rootConnectionName: value.rootConnectionName,
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isPoint(value: unknown): value is { x: number; y: number } {
  return (
    isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y)
  )
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value)
}
