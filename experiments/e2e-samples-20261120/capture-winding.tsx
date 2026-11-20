import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { RootCircuit, SOLVERS } from "../lib/index"
import { WindingBreakoutSolver } from "@tscircuit/winding-breakout-point-solver"
import { getCorrectWorkflowBoard } from "./correct-workflow"

const [sample, destination] = process.argv.slice(2)
const output = resolve(destination)
mkdirSync(output, { recursive: true })
const circuit = new RootCircuit()
let captureIndex = 0
const solveWinding = WindingBreakoutSolver.prototype.solve
WindingBreakoutSolver.prototype.solve = function () {
  const index = captureIndex++
  try {
    return solveWinding.call(this)
  } finally {
    const [input] = this.getConstructorParams()
    const connectionIds = new Set(input.connections.flatMap((connection) =>
      "type" in connection ? connection.connections.map((member) => member.id) : [connection.id],
    ))
    const capture = {
      input,
      solved: this.solved,
      failed: this.failed,
      error: this.error,
      output: this.solved ? this.getOutput() : null,
      regionNames: input.regions.map((region) => ({ id: region.id, name: circuit.db.pcb_group.get(region.id)?.name })),
      connectionNames: circuit.db.source_trace.list().filter((trace) => connectionIds.has(trace.source_trace_id)).map((trace) => ({ id: trace.source_trace_id, name: trace.name })),
    }
    writeFileSync(join(output, `winding-${index}.json.gz`), Bun.gzipSync(JSON.stringify(capture)))
  }
}

for (const constructor of [SOLVERS.FanoutSolver, SOLVERS.BusLanesPipelineSolver, SOLVERS.AutoroutingPipelineSolver9_PreloadedTraceGraph]) {
  constructor.prototype.step = function (): void {
    throw new Error("Winding input capture complete; routing intentionally not executed")
  }
}

try {
  const { default: Board } = await import(`./samples/${sample}.tsx`)
  const { default: Original } = await import(`./samples/${sample.replace(/-(original|spaced)$/, "")}-original.tsx`)
  const escapeWidthsByNativeNet = new Map(Original().props.source.nets.map((net: { nativeName: string; escapeWidth: number }) => [net.nativeName, net.escapeWidth]))
  circuit.add(getCorrectWorkflowBoard(Board(), { escapeWidthsByNativeNet }))
  await circuit.renderUntilSettled()
} finally {
  writeFileSync(join(output, "summary.json"), JSON.stringify({ sample, mode: "winding_input_capture_only", captureCount: captureIndex, errors: circuit.db.pcb_autorouting_error.list().map((error) => error.message) }, null, 2))
  console.log("WINDING_CAPTURE", sample, captureIndex)
}
