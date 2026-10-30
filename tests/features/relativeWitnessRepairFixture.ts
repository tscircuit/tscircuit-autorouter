import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { getPipeline9WitnessViaCertificate } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9WitnessViaCertificate"
import { provePipeline9RelativeContacts, type RelativeWitnessMove } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/provePipeline9RelativeContacts"
import { witnessViaPadRepairFixture } from "./witnessViaPadRepairFixture"

export function relativeWitnessRepairFixture(): ReturnType<typeof witnessViaPadRepairFixture> {
  const input = witnessViaPadRepairFixture()
  const wire = (x: number, y: number, layer: string): SimplifiedPcbTrace["route"][number] => ({ route_type: "wire", x, y, layer, width: 0.1 })
  input.traces[0]!.route.splice(4, 0, wire(-0.5, 1, "inner1"), wire(-0.02, 0.73, "inner1"))
  input.traces[0]!.route.splice(9, 0, wire(0, 0.1, "bottom"))
  input.originalSrj.connections.push({ name: "C", pointsToConnect: [{ x: 3, y: 3, layer: "top", pcb_port_id: "C0" }] })
  input.originalSrj.obstacles.push({ type: "rect", center: { x: 3, y: 3 }, width: 0.2, height: 0.2, layers: ["top"], connectedTo: ["C", "C0"], circuitJsonMetadata: { pcb_smtpad_id: "pcb_smtpad_4", pcb_port_id: "C0" } })
  const xs = [-3, -2.9, -2.6, -2.3, -2, -1.7, -1.4, -1]
  input.originalSrj.connections.push({ name: "D", pointsToConnect: [{ x: -3, y: -3, layer: "top", pcb_port_id: "D0" }, { x: -1, y: -3, layer: "top", pcb_port_id: "D1" }] })
  input.traces.push({ type: "pcb_trace", pcb_trace_id: "d", connection_name: "D", route: xs.map((x) => wire(x, -3, "top")) })
  input.pointPairs = structuredClone(input.originalSrj)
  return input
}

export function relativeFixtureProposal(input: ReturnType<typeof relativeWitnessRepairFixture>, withWire = true): { after: SimplifiedPcbTrace[]; moves: RelativeWitnessMove[] } {
  const after = structuredClone(input.traces)
  const via = { kind: "via" as const, occurrences: input.traces.flatMap((trace, traceIndex) => trace.route.flatMap((point, pointIndex) => "x" in point && point.x === 0 && point.y === 0.728 ? [{ traceIndex, pointIndex, oldXY: { x: 0, y: 0.728 }, newXY: { x: 0, y: 0.751 } }] : [])) }
  const moves: RelativeWitnessMove[] = [via]
  if (withWire) moves.push({ kind: "wire", occurrences: [3, 4].map((pointIndex) => {
    const point = input.traces[2]!.route[pointIndex] as { x: number; y: number }
    return { traceIndex: 2, pointIndex, oldXY: { x: point.x, y: point.y }, newXY: { x: point.x, y: point.y + 0.005 } }
  }) })
  for (const move of moves) for (const occurrence of move.occurrences) Object.assign(after[occurrence.traceIndex]!.route[occurrence.pointIndex]!, occurrence.newXY)
  return { after, moves }
}

export function proveRelativeFixture(input: ReturnType<typeof relativeWitnessRepairFixture>, proposal = relativeFixtureProposal(input)): ReturnType<typeof provePipeline9RelativeContacts> {
  return provePipeline9RelativeContacts({ original: input.originalSrj, pointPairs: input.pointPairs, before: input.traces, after: proposal.after, moves: proposal.moves,
    baselineCertificate: getPipeline9WitnessViaCertificate(input.originalSrj, input.pointPairs, input.traces), candidateCertificate: getPipeline9WitnessViaCertificate(input.originalSrj, input.pointPairs, proposal.after) })
}

export function jointRelativeWitnessRepairFixture(): ReturnType<typeof relativeWitnessRepairFixture> {
  const input = relativeWitnessRepairFixture()
  const pad = input.originalSrj.obstacles[4]!
  Object.assign(pad, { center: { x: -2, y: -3.5 }, width: 0.6, height: 0.6 })
  Object.assign(input.originalSrj.connections[2]!.pointsToConnect[0]!, pad.center)
  const points = [[-1, -2.5], [-1.3, -2.5], [-1.8, -2.6], [-2.12, -3], [-2.4, -3.075], [-2.6, -3.3], [-2.6, -3.8], [-3, -3.8]]
  input.traces[2]!.route = points.map(([x, y]) => ({ route_type: "wire", x: x!, y: y!, width: 0.1, layer: "top" }))
  for (const [index, point] of [[0, points[0]!], [1, points[7]!]] as const) Object.assign(input.originalSrj.connections[3]!.pointsToConnect[index]!, { x: point[0], y: point[1] })
  input.pointPairs = structuredClone(input.originalSrj)
  return input
}
