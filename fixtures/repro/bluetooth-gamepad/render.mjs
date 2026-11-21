import { EventEmitter } from "node:events"
import { cloneElement } from "react-for-pipeline9-fixtures"
import { Circuit } from "tscircuit-gamepad-fixture"
import Gamepad from "./board/index.tsx"

export async function renderGamepad(solve) {
  const circuit = new Circuit()
  circuit.add(
    cloneElement(Gamepad(), {
      autorouter: {
        local: true,
        algorithmFn: async (input) => {
          const events = new EventEmitter()
          return Object.assign(events, {
            start() {
              events.emit("complete", { traces: solve(input) })
            },
            stop() {},
          })
        },
      },
    }),
  )
  await circuit.renderUntilSettled()
  return circuit.getCircuitJson().filter((item) => item.type.endsWith("_error"))
}
