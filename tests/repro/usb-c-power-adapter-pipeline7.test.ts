import { expect, test } from "bun:test"
import circuitJson from "./assets/usb-c-power-adapter-circuit-json.json" with {
  type: "json",
}
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type {
  Obstacle,
  SimpleRouteConnection,
  SimpleRouteJson,
} from "lib/types"

type CircuitJsonElement = (typeof circuitJson)[number]

const getBounds = (points: Array<{ x: number; y: number }>) => ({
  minX: Math.min(...points.map((point) => point.x)),
  maxX: Math.max(...points.map((point) => point.x)),
  minY: Math.min(...points.map((point) => point.y)),
  maxY: Math.max(...points.map((point) => point.y)),
})

const getObstacleDimensions = (element: CircuitJsonElement) => {
  if ("width" in element && "height" in element) {
    return { width: element.width, height: element.height }
  }

  if ("outer_width" in element && "outer_height" in element) {
    return { width: element.outer_width, height: element.outer_height }
  }

  if ("outer_diameter" in element) {
    return { width: element.outer_diameter, height: element.outer_diameter }
  }

  if ("points" in element) {
    const bounds = getBounds(element.points)
    return {
      width: bounds.maxX - bounds.minX,
      height: bounds.maxY - bounds.minY,
    }
  }

  return null
}

const getObstacleCenter = (element: CircuitJsonElement) => {
  if ("x" in element && "y" in element) {
    return { x: element.x, y: element.y }
  }

  if ("points" in element) {
    const bounds = getBounds(element.points)
    return {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    }
  }

  return null
}

const getObstacleLayers = (element: CircuitJsonElement) => {
  if ("layers" in element) return element.layers
  if ("layer" in element) return [element.layer]
  return ["top"]
}

const convertCircuitJsonToSimpleRouteJson = (
  elements: CircuitJsonElement[],
): SimpleRouteJson => {
  const board = elements.find((element) => element.type === "pcb_board")
  if (!board || !("outline" in board)) {
    throw new Error("Expected circuit json to include a pcb_board outline")
  }

  const pcbPorts = new Map(
    elements
      .filter((element) => element.type === "pcb_port")
      .map((port) => [port.source_port_id, port]),
  )
  const sourcePortNetIds = new Map<string, Set<string>>()
  const sourcePortTraceIds = new Map<string, Set<string>>()

  const addToSetMap = (
    map: Map<string, Set<string>>,
    key: string,
    values: string[],
  ) => {
    const set = map.get(key) ?? new Set<string>()
    values.forEach((value) => set.add(value))
    map.set(key, set)
  }

  const sourceTraces = elements.filter(
    (element) => element.type === "source_trace",
  )

  for (const trace of sourceTraces) {
    for (const sourcePortId of trace.connected_source_port_ids) {
      addToSetMap(sourcePortTraceIds, sourcePortId, [trace.source_trace_id])
      addToSetMap(
        sourcePortNetIds,
        sourcePortId,
        trace.connected_source_net_ids ?? [],
      )
    }
  }

  const connections: SimpleRouteConnection[] = sourceTraces
    .map((trace) => {
      const pointsToConnect = trace.connected_source_port_ids
        .map((sourcePortId: string) => pcbPorts.get(sourcePortId))
        .filter((port: CircuitJsonElement | undefined): port is any =>
          Boolean(port),
        )
        .map((port: any) => ({
          x: port.x,
          y: port.y,
          layers: port.layers,
          pcb_port_id: port.pcb_port_id,
        }))

      return {
        name: trace.source_trace_id,
        netConnectionName: trace.connected_source_net_ids?.[0],
        pointsToConnect,
      }
    })
    .filter((connection) => connection.pointsToConnect.length >= 2)

  const obstacles: Obstacle[] = elements
    .filter(
      (element) =>
        element.type === "pcb_smtpad" || element.type === "pcb_plated_hole",
    )
    .flatMap((element) => {
      const center = getObstacleCenter(element)
      const dimensions = getObstacleDimensions(element)
      if (!center || !dimensions || !("pcb_port_id" in element)) return []

      const sourcePortId = elements.find(
        (candidate) =>
          candidate.type === "pcb_port" &&
          candidate.pcb_port_id === element.pcb_port_id,
      )?.source_port_id
      const connectedTo = sourcePortId
        ? [
            ...(sourcePortTraceIds.get(sourcePortId) ?? []),
            ...(sourcePortNetIds.get(sourcePortId) ?? []),
          ]
        : []

      return [
        {
          obstacleId:
            "pcb_smtpad_id" in element
              ? element.pcb_smtpad_id
              : element.pcb_plated_hole_id,
          componentId: element.pcb_component_id,
          type: "rect",
          layers: getObstacleLayers(element),
          center,
          width: dimensions.width,
          height: dimensions.height,
          ccwRotationDegrees:
            "ccw_rotation" in element ? element.ccw_rotation : undefined,
          connectedTo,
        },
      ]
    })

  return {
    layerCount: 4,
    minTraceWidth: 0.125,
    minViaHoleDiameter: 0.3,
    minViaPadDiameter: 0.6,
    obstacles,
    connections,
    bounds: getBounds(board.outline),
    outline: board.outline,
  }
}

test("usb-c power adapter pipeline7 does not create non-BGA component regions", () => {
  const srj = convertCircuitJsonToSimpleRouteJson(circuitJson)
  const solver = new AutoroutingPipelineSolver7_MultiGraph(srj, {
    cacheProvider: null,
  })
  const topologyPlanningStepIndex = solver.pipelineDef.findIndex(
    (step) => step.solverName === "topologyPlanningSolver",
  )

  while (
    !solver.solved &&
    !solver.failed &&
    solver.currentPipelineStepIndex <= topologyPlanningStepIndex
  ) {
    solver.step()
  }

  expect(solver.failed).toBe(false)
  const componentDetectionOutput = solver.componentDetectionSolver!.getOutput()
  const topologyOutput = solver.topologyPlanningSolver!.getOutput()

  expect(componentDetectionOutput.components).toHaveLength(0)
  expect(topologyOutput.componentMeshNodes.flat()).toHaveLength(0)
  expect(topologyOutput.mergedMeshNodes.length).toBeLessThan(2_000)
})
