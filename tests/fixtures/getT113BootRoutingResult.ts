import { FanoutSolver } from "@tscircuit/fanout-for-pipeline9-fixtures"
import type { CircuitJson } from "circuit-json"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { getT113BootRoutingCircuit } from "./getT113BootRoutingCircuit"

type BootRoutingResult = {
  circuitJson: CircuitJson
  srj: SimpleRouteJson
  preloadedTraces: SimplifiedPcbTrace[]
  sdInput: SimpleRouteJson
  sdSolver: AutoroutingPipelineSolver9_PreloadedTraceGraph
}

/** Every preload is generated here by an unmodified native solver. */
export const getT113BootRoutingResult = async (): Promise<BootRoutingResult> => {
  const { circuitJson, srj } = await getT113BootRoutingCircuit()
  const bootSignalInput = {
    ...srj,
    connections: srj.connections.filter(
      (connection) => connection.name === "source_trace_0",
    ),
    buses: [],
  }
  const bootSignalSolver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    bootSignalInput,
    { cacheProvider: null, effort: 1 },
  )
  bootSignalSolver.solve()
  if (!bootSignalSolver.solved) {
    throw new Error(`Boot signal routing failed: ${bootSignalSolver.error}`)
  }
  const bootSignalTraces = bootSignalSolver.getOutputSimplifiedPcbTraces()
  const groundConnections = srj.connections.filter(
    (connection) => connection.name === "source_trace_1",
  )
  const groundBuses = srj.buses!.filter((bus) =>
    bus.connectionNames.includes("source_trace_1"),
  )
  const bootPads = srj.obstacles.filter(
    (obstacle) =>
      obstacle.circuitJsonMetadata?.source_component_name === "R_BOOT_SEL1",
  )
  if (bootPads.length !== 2) throw new Error("Expected both boot resistor pads")
  const sharedBoundary = {
    minX: Math.min(...bootPads.map((pad) => pad.center.x - pad.width / 2)) - 3,
    maxX: Math.max(...bootPads.map((pad) => pad.center.x + pad.width / 2)) + 3,
    minY: Math.min(...bootPads.map((pad) => pad.center.y - pad.height / 2)) - 3,
    maxY: Math.max(...bootPads.map((pad) => pad.center.y + pad.height / 2)) + 3,
  }
  const groundFanout = new FanoutSolver(
    {
      ...srj,
      connections: groundConnections,
      buses: groundBuses,
      traces: bootSignalTraces,
    },
    {
      buses: groundBuses,
      borderDistribution: "even",
      compactBusTracks: true,
      busDirections: { BOOT_GND: "left" },
      escapeLayers: ["top", "inner1", "inner2", "bottom"],
      allowBlindAndBuriedVias: false,
      sharedBoundary,
    },
  )
  groundFanout.solve()
  if (!groundFanout.solved) {
    throw new Error(`Boot ground fanout failed: ${groundFanout.error}`)
  }
  const preloadedTraces = [
    ...bootSignalTraces,
    ...groundFanout.getOutput().fanoutTraces,
  ]
  const sdInput = {
    ...srj,
    connections: srj.connections.filter(
      (connection) =>
        !["source_trace_0", "source_trace_1"].includes(connection.name),
    ),
    buses: [],
    traces: preloadedTraces,
  }
  const sdSolver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(sdInput, {
    cacheProvider: null,
    effort: 1,
  })
  sdSolver.solve()
  return { circuitJson, srj, preloadedTraces, sdInput, sdSolver }
}
