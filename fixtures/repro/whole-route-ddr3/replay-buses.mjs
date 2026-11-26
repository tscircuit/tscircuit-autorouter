import { SOLVERS } from "tscircuit"

const bench = process.argv[2]
if (bench !== "allwinner-h3-k51" && bench !== "zynq-clg400-full45") {
  throw new Error("Choose allwinner-h3-k51 or zynq-clg400-full45.")
}
const inputs = []
for (const suffix of ["byte-phases.json.gz", "handoff.json.gz"]) {
  const url = new URL(`${bench}.${suffix}`, import.meta.url)
  const compressed = await Bun.file(url).bytes()
  inputs.push(JSON.parse(new TextDecoder().decode(Bun.gunzipSync(compressed))))
}
const [bytePhases, { inputSrj }] = inputs
let traces = bytePhases[0].traces ?? []
for (const [index, phase] of bytePhases.entries()) {
  const solver = new SOLVERS.BusLanesPipelineSolver({
    ...structuredClone(phase),
    traces,
  })
  solver.solve()
  if (!solver.solved || solver.failed) {
    throw new Error(`Byte ${index} routing failed. ${solver.error}`)
  }
  traces = [...traces, ...solver.traces]
  console.log(`Byte ${index} routed ${phase.connections.length} data signals.`)
}

if (JSON.stringify(traces) !== JSON.stringify(inputSrj.traces)) {
  throw new Error("The routed byte copper differs from the captured handoff.")
}
console.log("Routed byte copper matches the Pipeline 9 handoff.")
