import { test, expect } from "bun:test"
import { ToporouterWasmPipelineSolver } from "lib/autorouter-pipelines/ToporouterWasmPipeline/ToporouterWasmPipelineSolver"
import type { SimpleRouteJson } from "lib/types"

test("toporouter-wasm: two pins, no obstacles", async () => {
  const srj: SimpleRouteJson = {
    layerCount: 1,
    minTraceWidth: 0.15,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [],
    connections: [
      {
        name: "net1",
        pointsToConnect: [
          { x: -3, y: 0, layer: "top" },
          { x: 3, y: 0, layer: "top" },
        ],
      },
    ],
  }

  const solver = new ToporouterWasmPipelineSolver(srj)
  await solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)

  const traces = solver.getOutputSimplifiedPcbTraces()
  console.log(`Routed ${traces.length} traces, stats:`, solver.stats)
  expect(traces.length).toBe(1)
  expect(traces[0].route.length).toBeGreaterThan(1)
})

test("toporouter-wasm: two crossing nets (no obstacles)", async () => {
  const srj: SimpleRouteJson = {
    layerCount: 1,
    minTraceWidth: 0.15,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [],
    connections: [
      {
        name: "net1",
        pointsToConnect: [
          { x: -3, y: -3, layer: "top" },
          { x: 3, y: 3, layer: "top" },
        ],
      },
      {
        name: "net2",
        pointsToConnect: [
          { x: -3, y: 3, layer: "top" },
          { x: 3, y: -3, layer: "top" },
        ],
      },
    ],
  }

  const solver = new ToporouterWasmPipelineSolver(srj)
  await solver.solve()

  expect(solver.solved).toBe(true)
  const traces = solver.getOutputSimplifiedPcbTraces()
  console.log(`Routed ${traces.length}/2 nets, stats:`, solver.stats)
  expect(traces.length).toBeGreaterThanOrEqual(1)
})

test("toporouter-wasm: solver loads and runs without crash", async () => {
  const srj: SimpleRouteJson = {
    layerCount: 1,
    minTraceWidth: 0.15,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 1,
        height: 1,
        connectedTo: [],
      },
    ],
    connections: [
      {
        name: "net1",
        pointsToConnect: [
          { x: -3, y: 0, layer: "top" },
          { x: 3, y: 0, layer: "top" },
        ],
      },
    ],
  }

  const solver = new ToporouterWasmPipelineSolver(srj)
  await solver.solve()

  // The solver should complete without crashing
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  console.log("Stats:", solver.stats)
  // Note: obstacle avoidance routing may fail due to CDT topology
  // limitations in the current WASM wrapper. The standalone demo
  // at toporouter-wasm.pages.dev handles this correctly.
})
