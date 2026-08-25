import { expect, test } from "bun:test"
import { Pipeline9BranchRipDrcFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-branch-rip-drc-fallback-solver"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type {
  SimpleRouteJson,
  SimplifiedPcbTrace,
  SimplifiedPcbTraces,
} from "lib/types"

const fixedTrace: SimplifiedPcbTrace = {
  type: "pcb_trace",
  pcb_trace_id: "fixed_trace",
  connection_name: "FIXED",
  connectsTo: ["fixed_start", "fixed_end"],
  route: [
    {
      route_type: "wire",
      x: -2,
      y: 0,
      width: 0.15,
      layer: "top",
      start_pcb_port_id: "fixed_start",
    },
    {
      route_type: "wire",
      x: 2,
      y: 0,
      width: 0.15,
      layer: "top",
      end_pcb_port_id: "fixed_end",
    },
  ],
}

const movableTrace: SimplifiedPcbTrace = {
  type: "pcb_trace",
  pcb_trace_id: "movable_trace",
  connection_name: "MOVABLE",
  connectsTo: ["movable_start", "movable_end"],
  route: [
    {
      route_type: "wire",
      x: 0,
      y: -2,
      width: 0.15,
      layer: "top",
      start_pcb_port_id: "movable_start",
    },
    {
      route_type: "wire",
      x: 0,
      y: 2,
      width: 0.15,
      layer: "top",
      end_pcb_port_id: "movable_end",
    },
  ],
}

const srj: SimpleRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.15,
  bounds: { minX: -4, minY: -3, maxX: 4, maxY: 3 },
  obstacles: [],
  connections: [
    {
      name: "FIXED",
      pointsToConnect: [
        { x: -2, y: 0, layer: "top", pcb_port_id: "fixed_start" },
        { x: 2, y: 0, layer: "top", pcb_port_id: "fixed_end" },
      ],
    },
    {
      name: "MOVABLE",
      pointsToConnect: [
        { x: 0, y: -2, layer: "top", pcb_port_id: "movable_start" },
        { x: 0, y: 2, layer: "top", pcb_port_id: "movable_end" },
      ],
    },
  ],
}

class StubNestedPipeline9Solver extends BaseSolver {
  constructor(
    private readonly input: SimpleRouteJson,
    private readonly outputTraces: SimplifiedPcbTraces,
  ) {
    super()
  }

  override _step() {
    this.solved = true
  }

  getOutputSimpleRouteJson(): SimpleRouteJson {
    return { ...this.input, traces: structuredClone(this.outputTraces) }
  }
}

test("Pipeline9 branch-rip fallback reconnects one DRC branch without changing electrical constraints", () => {
  const detouredTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "nested_reroute",
    connection_name: "temporary_name",
    route: [
      { route_type: "wire", x: 0, y: 2, width: 0.15, layer: "top" },
      { route_type: "wire", x: 3, y: 2, width: 0.15, layer: "top" },
      { route_type: "wire", x: 3, y: -2, width: 0.15, layer: "top" },
      { route_type: "wire", x: 0, y: -2, width: 0.15, layer: "top" },
    ],
  }
  const solver = new Pipeline9BranchRipDrcFallbackSolver({
    originalSrj: srj,
    currentTraces: [fixedTrace, movableTrace],
    eligibleTraceIds: new Set([movableTrace.pcb_trace_id]),
    createNestedSolver: (input) =>
      new StubNestedPipeline9Solver(input, [fixedTrace, detouredTrace]),
  })

  solver.solve()

  expect(solver.stats).toMatchObject({
    initialDrcCount: 1,
    finalDrcCount: 0,
    acceptedTraceId: movableTrace.pcb_trace_id,
  })
  const expectedReroutedTrace: SimplifiedPcbTrace = {
    ...detouredTrace,
    connection_name: movableTrace.connection_name,
    connectsTo: ["movable_start", "movable_end"],
    route: [
      {
        route_type: "wire",
        x: 0,
        y: 2,
        width: 0.15,
        layer: "top",
        start_pcb_port_id: "movable_end",
      },
      { route_type: "wire", x: 3, y: 2, width: 0.15, layer: "top" },
      { route_type: "wire", x: 3, y: -2, width: 0.15, layer: "top" },
      {
        route_type: "wire",
        x: 0,
        y: -2,
        width: 0.15,
        layer: "top",
        end_pcb_port_id: "movable_start",
      },
    ],
  }
  expect(solver.getOutput()).toEqual([fixedTrace, expectedReroutedTrace])
})

test("Pipeline9 branch-rip fallback rejects a reroute with a changed trace width", () => {
  const wrongWidthTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "nested_reroute",
    connection_name: "temporary_name",
    route: [
      { route_type: "wire", x: 0, y: 2, width: 0.2, layer: "top" },
      { route_type: "wire", x: 3, y: 2, width: 0.2, layer: "top" },
      { route_type: "wire", x: 3, y: -2, width: 0.2, layer: "top" },
      { route_type: "wire", x: 0, y: -2, width: 0.2, layer: "top" },
    ],
  }
  const solver = new Pipeline9BranchRipDrcFallbackSolver({
    originalSrj: srj,
    currentTraces: [fixedTrace, movableTrace],
    eligibleTraceIds: new Set([movableTrace.pcb_trace_id]),
    createNestedSolver: (input) =>
      new StubNestedPipeline9Solver(input, [fixedTrace, wrongWidthTrace]),
  })

  solver.solve()

  expect(solver.stats).toMatchObject({
    initialDrcCount: 1,
    candidatesAttempted: 1,
    candidatesRejectedForInvariant: 1,
  })
  expect(solver.getOutput()).toEqual([fixedTrace, movableTrace])
})

test("Pipeline9 branch-rip fallback marks adjusted preloaded copper as a replacement", () => {
  const adjustedFixedTrace: SimplifiedPcbTrace = {
    ...fixedTrace,
    route: [
      fixedTrace.route[0]!,
      { route_type: "wire", x: -2, y: 0.5, width: 0.15, layer: "top" },
      { route_type: "wire", x: 2, y: 0.5, width: 0.15, layer: "top" },
      fixedTrace.route[1]!,
    ],
  }
  const detouredTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "nested_reroute",
    connection_name: "temporary_name",
    route: [
      { route_type: "wire", x: 0, y: 2, width: 0.15, layer: "top" },
      { route_type: "wire", x: 3, y: 2, width: 0.15, layer: "top" },
      { route_type: "wire", x: 3, y: -2, width: 0.15, layer: "top" },
      { route_type: "wire", x: 0, y: -2, width: 0.15, layer: "top" },
    ],
  }
  const solver = new Pipeline9BranchRipDrcFallbackSolver({
    originalSrj: { ...srj, traces: [fixedTrace] },
    currentTraces: [fixedTrace, movableTrace],
    eligibleTraceIds: new Set([movableTrace.pcb_trace_id]),
    createNestedSolver: (input) =>
      new StubNestedPipeline9Solver(input, [adjustedFixedTrace, detouredTrace]),
  })

  solver.solve()

  expect(solver.stats).toMatchObject({
    initialDrcCount: 1,
    finalDrcCount: 0,
    preservedTraceMutationCount: 1,
  })
  expect(solver.getOutput()[0]).toMatchObject({
    pcb_trace_id: fixedTrace.pcb_trace_id,
    __replaces_pcb_trace_id: fixedTrace.pcb_trace_id,
    route: adjustedFixedTrace.route,
  })
})
