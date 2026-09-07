import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPipeline9HighDensityDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9HighDensityDrcEvaluator"
import {
  getPipeline9HighDensityForceCandidates,
  type Pipeline9HighDensityForceFamily,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9HighDensityForceCandidates"
import { getPipeline9DrcErrors } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types/srj-types"

type ForceAttempt = {
  family: Pipeline9HighDensityForceFamily
  scale: number
  application: number
}
type ForceSearch = {
  attempts: ForceAttempt[]
  candidates: HighDensityRoute[][]
  rejections: string[]
}

test("Pipeline9 preserves untouched rounded via metadata without changing force geometry or bypassing bounds", (): void => {
  const target: HighDensityRoute = {
    connectionName: "A",
    rootConnectionName: "A",
    regionId: "via-metadata-node",
    startPcbPortId: "A-start",
    endPcbPortId: "A-end",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -4, y: 2, z: 0, pcb_port_id: "A-start" },
      { x: -1, y: 0, z: 0, traceThickness: 0.1 },
      { x: 1, y: 0, z: 0, traceThickness: 0.1 },
      { x: 3.123456, y: 2, z: 0 },
      { x: 3.123456, y: 2, z: 1 },
      { x: 4, y: 2, z: 1, pcb_port_id: "A-end" },
    ],
    vias: [{ x: 3.123, y: 2 }],
  }
  const neighbour: HighDensityRoute = {
    connectionName: "B",
    rootConnectionName: "B",
    regionId: "via-metadata-node",
    startPcbPortId: "B-start",
    endPcbPortId: "B-end",
    traceThickness: 0.12,
    viaDiameter: 0.3,
    route: [
      { x: -4, y: 3, z: 0 },
      { x: -2.234567, y: 3, z: 0 },
      { x: -2.234567, y: 3, z: 1 },
      { x: 4, y: 3, z: 1 },
    ],
    // Ordinary HD output can round these independently of transition points.
    vias: [{ x: -2.235, y: 3 }],
  }
  const inputRoutes = [target, neighbour]
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "via-metadata-node",
    center: { x: 0, y: 0 },
    width: 10,
    height: 10,
    availableZ: [0, 1],
    portPoints: inputRoutes.flatMap((route) =>
      [route.route[0]!, route.route.at(-1)!].map((point) => ({
        ...point,
        connectionName: route.connectionName,
      })),
    ),
  }
  const connMap = new ConnectivityMap({
    A: ["A", "A-start", "A-end"],
    B: ["B", "B-start", "B-end"],
    C: ["C", "C-start", "C-end"],
  })
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: -0.12 },
        width: 0.2,
        height: 0.02,
        layers: ["top"],
        connectedTo: ["C", "C-start"],
        circuitJsonMetadata: {
          pcb_smtpad_id: "foreign-pad",
          pcb_port_id: "C-start",
        },
      },
    ],
    connections: [
      ...inputRoutes.map((route) => ({
        name: route.connectionName,
        pointsToConnect: [route.route[0]!, route.route.at(-1)!].map(
          (point, index) => ({
            x: point.x,
            y: point.y,
            layer: point.z === 0 ? "top" : "bottom",
            pcb_port_id:
              index === 0 ? route.startPcbPortId : route.endPcbPortId,
          }),
        ),
      })),
      {
        name: "C",
        pointsToConnect: [
          { x: 0, y: -0.12, layer: "top", pcb_port_id: "C-start" },
          { x: 0, y: -4, layer: "top", pcb_port_id: "C-end" },
        ],
      },
    ],
  }
  const evaluator = createPipeline9HighDensityDrcEvaluator({
    connections: srj.connections.filter(
      (connection) => connection.name !== "C",
    ),
    originalConnections: srj.connections,
    originalFixedHdRoutes: [],
    fixedHdRoutes: [],
    changedPreloadedTraceSections: [],
    hdRoutes: inputRoutes,
    layerCount: 2,
    obstacles: srj.obstacles,
    defaultViaHoleDiameter: 0.15,
    connMap,
    originalSrj: srj,
    srjWithPointPairs: srj,
  })
  const errors = getPipeline9DrcErrors(evaluator, inputRoutes)
  expect(errors).toHaveLength(1)
  expect(errors[0]).toMatchObject({
    type: "pcb_pad_trace_clearance_error",
    pcb_trace_id: "A_0",
    __pad_ids: ["foreign-pad"],
  })
  const forceContext = evaluator.getForceContext(inputRoutes)
  const original = structuredClone({ inputRoutes, node, srj, errors })
  const collectCandidates = (hdRoutes: HighDensityRoute[]): ForceSearch => {
    const attempts: ForceAttempt[] = []
    const rejections: string[] = []
    const candidates = [
      ...getPipeline9HighDensityForceCandidates({
        node,
        hdRoutes,
        errors,
        traceRouteIndexById: new Map(
          hdRoutes.map((route, index) => [`${route.connectionName}_0`, index]),
        ),
        obstacles: srj.obstacles,
        layerCount: 2,
        viaDiameter: 0.3,
        viaHoleDiameter: 0.15,
        traceWidth: 0.1,
        obstacleMargin: 0.15,
        connMap,
        forceContext,
        effort: 1,
        onCandidateAttempted: (family, scale, application): void => {
          attempts.push({ family, scale, application })
        },
        onCandidateRejected: (reason): void => {
          rejections.push(reason)
        },
      }),
    ]
    return { attempts, candidates, rejections }
  }
  const withNeighbour = collectCandidates(inputRoutes)
  const targetOnly = collectCandidates([target])
  expect(withNeighbour.candidates.length).toBeGreaterThan(1)
  expect(withNeighbour.attempts).toEqual(targetOnly.attempts)
  expect(withNeighbour.rejections).toEqual(targetOnly.rejections)
  expect(withNeighbour.candidates.map((routes) => routes[0])).toEqual(
    targetOnly.candidates.map((routes) => routes[0]),
  )
  const first = withNeighbour.candidates[0]!
  expect(getPipeline9DrcErrors(evaluator, first)).toHaveLength(0)
  // A genuinely changed route still derives its original exact via site.
  expect(first[0]!.vias).toEqual([{ x: 3.123456, y: 2 }])
  expect(first[0]!.vias).not.toEqual(target.vias)
  for (const candidate of withNeighbour.candidates) {
    expect(candidate[1]).toEqual(neighbour)
    expect(candidate[1]).not.toBe(neighbour)
    expect(candidate[1]!.route).not.toBe(neighbour.route)
    expect(candidate[1]!.vias).not.toBe(neighbour.vias)
    expect(candidate[1]!.vias[0]).not.toBe(neighbour.vias[0])
    for (const [index, point] of candidate[1]!.route.entries()) {
      expect(point).not.toBe(neighbour.route[index])
    }
  }
  const laterCandidates = structuredClone(withNeighbour.candidates.slice(1))
  first[1]!.route[1]!.y = 99
  first[1]!.vias[0]!.x = 99
  expect(withNeighbour.candidates.slice(1)).toEqual(laterCandidates)
  expect({ inputRoutes, node, srj, errors }).toEqual(original)
  // Unchanged status is not permission to skip the original native domain.
  const invalidNeighbour = structuredClone(neighbour)
  invalidNeighbour.route[1]!.x = 5.01
  invalidNeighbour.route[2]!.x = 5.01
  const invalid = collectCandidates([target, invalidNeighbour])
  expect(invalid.candidates).toHaveLength(0)
  expect(invalid.rejections).toContain("geometry")
})
