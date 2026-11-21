import { expect, test } from "bun:test"
import { Circuit } from "tscircuit-gamepad-fixture"
import { EventEmitter } from "node:events"
import { cloneElement } from "react-for-pipeline9-fixtures"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import Gamepad from "../fixtures/bluetooth-gamepad"

test("default Pipeline9 DRC count on the full Bluetooth gamepad", async () => {
  const circuit = new Circuit()
  let completed = false
  circuit.add(cloneElement(Gamepad(), {
    autorouter: {
      local: true,
      algorithmFn: async (input: SimpleRouteJson) => {
        const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
          cacheProvider: null,
        })
        const events = new EventEmitter()
        return Object.assign(events, {
          start(): void {
            solver.solve()
            expect(solver.solved).toBe(true)
            expect(solver.failed).toBe(false)
            completed = true
            events.emit("complete", { traces: solver.getOutputSimplifiedPcbTraces() })
          },
          stop(): void {},
          getOutputSimpleRouteJson: () => solver.getOutputSimpleRouteJson(),
        })
      },
    },
  }))
  await circuit.renderUntilSettled()
  expect(completed).toBe(true)
  const errors = circuit.getCircuitJson().filter((element) => element.type.endsWith("_error"))
  expect(errors.length).toMatchInlineSnapshot(`10`)
})
