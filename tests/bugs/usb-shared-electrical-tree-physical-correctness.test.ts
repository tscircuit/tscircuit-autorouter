import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import phase1Input from "../fixtures/bug-reports/usb-dp-phase-detour/input.json"
import phase0Input from "../fixtures/bug-reports/usb-dp-phase-detour/phase-0.input.json"

test("shared physical trees keep USB phases clean, preserve preload ownership and retain the short via-free shield path", (): void => {
  const route = (input: SimpleRouteJson): { solver: Pipeline; output: SimpleRouteJson } => {
    const solver = new Pipeline(structuredClone(input), { effort: 1, cacheProvider: null })
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    const output = solver.getOutputSimpleRouteJson()
    expect(evaluateRelaxedDrc({ inputSrj: output, srjWithPointPairs: solver.srjWithPointPairs!, routedTraces: [], includeBoardClearance: true }).errors).toEqual([])
    const movable = new Set(solver.getMutatedPreloadedTraces().map((trace) => trace.pcb_trace_id))
    for (const original of input.traces ?? []) {
      const updated = output.traces!.find((trace) => trace.pcb_trace_id === original.pcb_trace_id)!
      expect(updated).toBeDefined()
      expect(updated.connection_name).toBe(original.connection_name)
      expect(updated.connectsTo).toEqual(original.connectsTo)
      expect(updated.route[0]).toEqual(original.route[0])
      expect(updated.route.at(-1)).toEqual(original.route.at(-1))
      if (JSON.stringify(updated.route) !== JSON.stringify(original.route)) {
        expect(movable.has(original.pcb_trace_id)).toBe(true)
        expect(updated.__replaces_pcb_trace_id).toBe(original.pcb_trace_id)
      } else if (!movable.has(original.pcb_trace_id)) {
        expect(updated).toEqual(original)
      }
    }
    return { solver, output }
  }
  const direct = route(phase1Input)
  expect(direct.solver.portPointPathingSolver!.stats.electricalTreeSharedEdgeCount).toBeGreaterThan(0)
  expect(direct.solver.pipeline9JointDrcRepairSolver!.stats.electricalTreeWholeBranchAccepted).toBeGreaterThan(0)
  const phase0 = route(phase0Input)
  const shieldBranches = phase0.output.traces!.filter((trace) => trace.connection_name === "source_net_16")
  const adjacency = new Map<string, Array<{ id: string; length: number; vias: number }>>()
  for (const trace of shieldBranches) {
    expect(trace.connectsTo).toHaveLength(2)
    const [a, b] = trace.connectsTo!
    let length = 0
    for (let index = 1; index < trace.route.length; index++) {
      const previous = trace.route[index - 1]!, point = trace.route[index]!
      if (previous.route_type === "wire" && point.route_type === "wire") length += Math.hypot(point.x - previous.x, point.y - previous.y)
    }
    const vias = trace.route.filter((point) => point.route_type === "via").length
    for (const [from, to] of [[a!, b!], [b!, a!]]) {
      const edges = adjacency.get(from!) ?? []
      edges.push({ id: to!, length, vias })
      adjacency.set(from!, edges)
    }
  }
  const pending = [{ id: "pcb_port_32", length: 0, vias: 0 }]
  const reached = new Set<string>()
  let shieldPath: { length: number; vias: number } | undefined
  while (pending.length > 0) {
    pending.sort((a, b) => b.length - a.length)
    const current = pending.pop()!
    if (reached.has(current.id)) continue
    reached.add(current.id)
    if (current.id === "pcb_port_30") {
      shieldPath = current
      break
    }
    for (const edge of adjacency.get(current.id) ?? []) pending.push({ id: edge.id, length: current.length + edge.length, vias: current.vias + edge.vias })
  }
  expect(shieldPath).toBeDefined()
  expect(shieldPath!.length).toBeLessThan(10)
  expect(shieldPath!.vias).toBe(0)
  const phase1 = route({ ...structuredClone(phase1Input), traces: phase0.output.traces })
  const shield = phase0.output.traces!.find((trace) => trace.pcb_trace_id === "source_net_16_mst4_0")!
  expect(phase1.output.traces!.find((trace) => trace.pcb_trace_id === shield.pcb_trace_id)).toEqual(shield)
})
