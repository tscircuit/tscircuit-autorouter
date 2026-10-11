import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { evaluateConnectionCoverage } from "../scripts/parallel-benchmark/parallelBenchmarkConnectionCoverage"
import { convertToCircuitJson } from "../lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "../lib/types/srj-types"

test("benchmark connection coverage checks original root nets, absent routes, physical contacts, layers, vias, and rotated pads", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -1, maxX: 5, minY: -1, maxY: 5 },
    connections: [{
      name: "net",
      pointsToConnect: [
        { x: 0, y: 0, layer: "top", pcb_port_id: "p0" },
        { x: 4, y: 4, layer: "bottom", pcb_port_id: "p1" },
      ],
    }],
    obstacles: [
      { type: "rect", center: { x: 0, y: 0 }, width: 0.4, height: 0.4, layers: ["top"], connectedTo: ["p0"] },
      { type: "rect", center: { x: 4, y: 4 }, width: 0.4, height: 0.4, layers: ["bottom"], connectedTo: ["p1"] },
    ],
  }
  const traces: SimplifiedPcbTrace[] = [
    { type: "pcb_trace", pcb_trace_id: "top", connection_name: "net", route: [
      { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: 4, y: 0, width: 0.1, layer: "top" },
    ] },
    { type: "pcb_trace", pcb_trace_id: "bottom", connection_name: "net", route: [
      { route_type: "wire", x: 4, y: 0, width: 0.1, layer: "bottom" },
      { route_type: "wire", x: 4, y: 4, width: 0.1, layer: "bottom" },
    ] },
  ]
  const convert = (input: SimpleRouteJson, routes: SimplifiedPcbTrace[]): AnyCircuitElement[] =>
    convertToCircuitJson(input, routes, { originalSrj: input, includeOriginalConnections: true })
  const absent = evaluateConnectionCoverage(srj, convert(srj, []))
  expect(absent.summary.requiredNetCount).toBe(1)
  expect(absent.summary.requiredPairCount).toBe(1)
  expect(absent.summary.uncoveredNetCount).toBe(1)
  expect(absent.missingRouteNets).toHaveLength(1)
  const separateLayers = evaluateConnectionCoverage(srj, convert(srj, traces))
  expect(separateLayers.summary.coveredNetCount).toBe(0)
  expect(separateLayers.summary.uncoveredNetCount).toBe(1)
  expect(separateLayers.continuityErrors.some((error) => error.pcb_port_ids.includes("p1"))).toBe(true)
  const withVia = convert(srj, traces)
  withVia.push({
    type: "pcb_via", pcb_via_id: "via", pcb_trace_id: "top",
    x: 4, y: 0, outer_diameter: 0.3, hole_diameter: 0.15, layers: ["top", "bottom"],
  } as AnyCircuitElement)
  const bridged = evaluateConnectionCoverage(srj, withVia)
  expect(bridged.summary.coveredNetCount).toBe(1)
  expect(bridged.summary.errorCount).toBe(0)

  const implicitJump: SimplifiedPcbTrace[] = [{
    type: "pcb_trace", pcb_trace_id: "jump", connection_name: "net",
    route: [...traces[0]!.route, ...traces[1]!.route],
  }]
  expect(evaluateConnectionCoverage(srj, convert(srj, implicitJump)).summary.uncoveredNetCount).toBe(1)
  const wrongSpan = convert(srj, implicitJump)
  wrongSpan.push({
    type: "pcb_via", pcb_via_id: "wrong-span", pcb_trace_id: "jump",
    x: 4, y: 0, outer_diameter: 0.3, hole_diameter: 0.15, layers: ["top"],
  } as AnyCircuitElement)
  expect(evaluateConnectionCoverage(srj, wrongSpan).summary.uncoveredNetCount).toBe(1)
  const validImplicitJump = convert(srj, implicitJump)
  validImplicitJump.push({ ...withVia.at(-1)!, pcb_trace_id: "jump" } as AnyCircuitElement)
  expect(evaluateConnectionCoverage(srj, validImplicitJump).summary.errorCount).toBe(0)
  const withPlatedHole = convert(srj, implicitJump)
  withPlatedHole.push({
    type: "pcb_plated_hole", pcb_plated_hole_id: "barrel", shape: "circle",
    x: 4, y: 0, outer_diameter: 0.4, hole_diameter: 0.2, layers: ["top", "bottom"],
  })
  expect(evaluateConnectionCoverage(srj, withPlatedHole).summary.errorCount).toBe(0)
  const genericHoleLayers = structuredClone(withPlatedHole)
  const genericHole = genericHoleLayers.at(-1)!
  if (genericHole.type !== "pcb_plated_hole") throw new Error("Expected plated hole")
  genericHole.layers = ["top", "inner1", "inner2", "bottom"]
  expect(evaluateConnectionCoverage(srj, genericHoleLayers).summary.errorCount).toBe(0)
  const wrongHoleSpan = structuredClone(withPlatedHole)
  const hole = wrongHoleSpan.at(-1)!
  if (hole.type !== "pcb_plated_hole") throw new Error("Expected plated hole")
  hole.layers = ["top"]
  expect(evaluateConnectionCoverage(srj, wrongHoleSpan).summary.uncoveredNetCount).toBe(1)
  const brokenViaContact = convert(srj, implicitJump)
  brokenViaContact.push({ ...withVia.at(-1)!, x: 3, pcb_trace_id: "jump" } as AnyCircuitElement)
  expect(evaluateConnectionCoverage(srj, brokenViaContact).summary.uncoveredNetCount).toBe(1)
  for (const [viaX, viaLayers] of [[3, ["top", "bottom"]], [4, ["bottom"]]] as const) {
    const viaGap = convert(srj, implicitJump)
    const trace = viaGap.find((element) => element.type === "pcb_trace")!
    if (trace.type !== "pcb_trace") throw new Error("Expected trace")
    trace.route.splice(2, 0,
      { route_type: "via", x: 4, y: 0, from_layer: "top", to_layer: "top" },
      { route_type: "via", x: viaX, y: 0, from_layer: "bottom", to_layer: "bottom" },
    )
    viaGap.push({
      type: "pcb_via", pcb_via_id: "gap-a", pcb_trace_id: "jump",
      x: 4, y: 0, outer_diameter: 0.3, hole_diameter: 0.15, layers: ["top"],
    } as AnyCircuitElement, {
      type: "pcb_via", pcb_via_id: "gap-b", pcb_trace_id: "jump",
      x: viaX, y: 0, outer_diameter: 0.3, hole_diameter: 0.15, layers: [...viaLayers],
    } as AnyCircuitElement)
    expect(evaluateConnectionCoverage(srj, viaGap).summary.uncoveredNetCount).toBe(1)
  }

  const duplicateTerminal = structuredClone(srj)
  duplicateTerminal.connections[0]!.pointsToConnect.push({ x: 4, y: 4, layer: "bottom", pcb_port_id: "p2" })
  const sharedPadCircuit = convert(duplicateTerminal, traces)
  sharedPadCircuit.push(withVia.at(-1)!)
  const sharedPadCoverage = evaluateConnectionCoverage(duplicateTerminal, sharedPadCircuit)
  expect(sharedPadCoverage.summary.requiredPairCount).toBe(2)
  expect(sharedPadCoverage.summary.errorCount).toBe(0)
  expect(sharedPadCoverage.coincidentPadAliases).toContainEqual({ portId: "p2", existingPortId: "p1" })
  duplicateTerminal.connections[0]!.pointsToConnect[2] = { x: 4, y: 4, layer: "top", pcb_port_id: "p2" }
  const wrongLayerAlias = convert(duplicateTerminal, traces)
  wrongLayerAlias.push(withVia.at(-1)!)
  expect(evaluateConnectionCoverage(duplicateTerminal, wrongLayerAlias).summary.uncoveredNetCount).toBe(1)

  const aliases = structuredClone(srj)
  aliases.connections = srj.connections[0]!.pointsToConnect.map((point, index) => ({
    name: `branch${index}`, rootConnectionName: "original-root", pointsToConnect: [point],
  }))
  const aliasTraces = structuredClone(traces)
  aliasTraces[0]!.connection_name = "branch0"
  aliasTraces[1]!.connection_name = "branch1"
  const aliasCircuit = convert(aliases, aliasTraces)
  aliasCircuit.push(withVia.at(-1)!)
  const sharedRoot = evaluateConnectionCoverage(aliases, aliasCircuit)
  expect(sharedRoot.summary.requiredNetCount).toBe(1)
  expect(sharedRoot.summary.singletonNetCount).toBe(0)
  expect(sharedRoot.summary.errorCount).toBe(0)
  expect(evaluateConnectionCoverage(aliases, convert(aliases, [aliasTraces[0]!])).summary.uncoveredNetCount).toBe(1)

  const singleton = structuredClone(srj)
  singleton.connections = [{ name: "unused", pointsToConnect: [srj.connections[0]!.pointsToConnect[0]!] }]
  const singletonCoverage = evaluateConnectionCoverage(singleton, convert(singleton, []))
  expect(singletonCoverage.summary.requiredNetCount).toBe(0)
  expect(singletonCoverage.summary.singletonNetCount).toBe(1)
  expect(singletonCoverage.summary.errorCount).toBe(0)

  const topOnly = structuredClone(srj)
  topOnly.connections[0]!.pointsToConnect[1] = { x: 4, y: 4, layer: "top", pcb_port_id: "p1" }
  topOnly.obstacles[1]!.layers = ["top"]
  topOnly.obstacles[1]!.width = 2
  topOnly.obstacles[1]!.height = 0.2
  topOnly.obstacles[1]!.ccwRotationDegrees = 45
  const straight: SimplifiedPcbTrace[] = [{
    type: "pcb_trace", pcb_trace_id: "straight", connection_name: "net", route: [
      { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: 4.5, y: 4.5, width: 0.1, layer: "top" },
    ],
  }]
  expect(evaluateConnectionCoverage(topOnly, convert(topOnly, straight)).summary.errorCount).toBe(0)
  straight[0]!.route[1] = { route_type: "wire", x: 4.5, y: 3.5, width: 0.1, layer: "top" }
  expect(evaluateConnectionCoverage(topOnly, convert(topOnly, straight)).summary.uncoveredNetCount).toBe(1)

  const pointTerminals = structuredClone(topOnly)
  pointTerminals.obstacles = []
  straight[0]!.route[1] = { route_type: "wire", x: 4, y: 4, width: 0.1, layer: "top" }
  const pointCoverage = evaluateConnectionCoverage(pointTerminals, convert(pointTerminals, straight))
  expect(pointCoverage.summary.errorCount).toBe(0)
  expect(pointCoverage.pointTerminalPortIds).toEqual(["p0", "p1"])
  straight[0]!.route[1] = { route_type: "wire", x: 3, y: 3, width: 0.1, layer: "top" }
  expect(evaluateConnectionCoverage(pointTerminals, convert(pointTerminals, straight)).summary.uncoveredNetCount).toBe(1)
  straight[0]!.route[1] = { route_type: "wire", x: 4, y: 4, width: 0.1, layer: "bottom" }
  expect(evaluateConnectionCoverage(pointTerminals, convert(pointTerminals, straight)).summary.uncoveredNetCount).toBe(1)
  const missingPort = convert(srj, traces).filter((element) => element.type !== "pcb_port" || element.pcb_port_id !== "p1")
  missingPort.push(withVia.at(-1)!)
  expect(evaluateConnectionCoverage(srj, missingPort).summary.missingPortCount).toBe(1)

  const variableWidth = structuredClone(srj)
  variableWidth.connections[0]!.pointsToConnect[1] = { x: 4, y: 0.4, layer: "top", pcb_port_id: "p1" }
  variableWidth.obstacles[1]!.center = { x: 4, y: 0.4 }
  variableWidth.obstacles[1]!.layers = ["top"]
  const separatedCopper: SimplifiedPcbTrace[] = [
    { type: "pcb_trace", pcb_trace_id: "narrow", connection_name: "net", route: [
      { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: 2, y: 0, width: 1, layer: "top" },
    ] },
    { type: "pcb_trace", pcb_trace_id: "offset", connection_name: "net", route: [
      { route_type: "wire", x: 2, y: 0.4, width: 0.1, layer: "top" },
      { route_type: "wire", x: 4, y: 0.4, width: 0.1, layer: "top" },
    ] },
  ]
  expect(evaluateConnectionCoverage(variableWidth, convert(variableWidth, separatedCopper)).summary.uncoveredNetCount).toBe(1)
  const orphanVia = convert(srj, [
    { ...traces[0]!, route: [traces[0]!.route[0]!, { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" }] },
    { ...traces[1]!, route: [{ route_type: "wire", x: 4, y: 3, width: 0.1, layer: "bottom" }, traces[1]!.route[1]!] },
  ])
  orphanVia.push({
    type: "pcb_via", pcb_via_id: "orphan", pcb_trace_id: "top",
    x: 4, y: 3, outer_diameter: 0.3, hole_diameter: 0.15, layers: ["top", "bottom"],
  } as AnyCircuitElement)
  expect(evaluateConnectionCoverage(srj, orphanVia).summary.uncoveredNetCount).toBe(1)
  const duplicateIds = convert(variableWidth, separatedCopper.map((trace) => ({ ...trace, pcb_trace_id: "same-id" })))
  expect(evaluateConnectionCoverage(variableWidth, duplicateIds).summary.uncoveredNetCount).toBe(1)

  const interiorTerminal = structuredClone(pointTerminals)
  interiorTerminal.connections[0]!.pointsToConnect.push({ x: 2, y: 2, layer: "top", pcb_port_id: "p2" })
  straight[0]!.route[1] = { route_type: "wire", x: 4, y: 4, width: 0.1, layer: "top" }
  expect(evaluateConnectionCoverage(interiorTerminal, convert(interiorTerminal, straight)).summary.errorCount).toBe(0)
  const alternativeLayers = structuredClone(srj)
  alternativeLayers.obstacles = []
  alternativeLayers.connections[0]!.pointsToConnect.push({ x: 4, y: 0, layers: ["top", "bottom"], pcb_port_id: "p2" })
  expect(evaluateConnectionCoverage(alternativeLayers, convert(alternativeLayers, traces)).summary.uncoveredNetCount).toBe(1)
  const alternativeVia = convert(alternativeLayers, traces)
  alternativeVia.push(withVia.at(-1)!)
  expect(evaluateConnectionCoverage(alternativeLayers, alternativeVia).summary.errorCount).toBe(0)

  const offsetSharedPad = structuredClone(srj)
  offsetSharedPad.connections[0]!.pointsToConnect.push({ x: 4.1, y: 4, layer: "bottom", pcb_port_id: "p2" })
  offsetSharedPad.obstacles[1]!.connectedTo.push("p2")
  const offsetPadCircuit = convert(offsetSharedPad, traces)
  offsetPadCircuit.push(withVia.at(-1)!)
  expect(evaluateConnectionCoverage(offsetSharedPad, offsetPadCircuit).summary.errorCount).toBe(0)
})
