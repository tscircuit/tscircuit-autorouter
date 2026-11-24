import { test } from "bun:test"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "./lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex")
}
test("capture unchanged pre-routing geometry under the normal test preload", (): void => {
  for (const [name, file] of [["stmp157", "stmp157-remaining-mesh/input.srj.json.gz"], ["a64", "a64-ddr-edge-lookup/input.srj.json.gz"]]) {
    const input = JSON.parse(gunzipSync(readFileSync(`tests/fixtures/assets/${file}`)).toString())
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {cacheProvider:null})
    while (!solver.solved && !solver.failed) {
      if (name === "stmp157" && solver.topologyMergingSolver?.stats.processedXSlabCount === 1000) break
      if (name === "a64" && solver.edgeSolver?.solved) break
      solver.step()
    }
    console.log("PRE_HD=" + JSON.stringify({revision:process.env.REVISION,name,failed:solver.failed,error:solver.error,input:hash(input),components:hash(solver.componentDetectionSolver?.getOutput()),planner:hash(solver.topologyPlanningSolver?.getOutput()),merger:solver.topologyMergingSolver?.stats,nodes:solver.capacityNodes?.length,edges:solver.capacityEdges?.length,edgesSha:hash(solver.capacityEdges)}))
  }
  for (const name of ["@tscircuit/rectdiff", "@tscircuit/solver-utils", "@tscircuit/math-utils", "graphics-debug", "circuit-json"]) {
    const path=`node_modules/${name}`
    const pkg=JSON.parse(readFileSync(`${path}/package.json`,"utf8"))
    const entry=pkg.module ?? pkg.main ?? "index.js"
    console.log("GEOMETRY_DEP="+JSON.stringify({revision:process.env.REVISION,name,version:pkg.version,entry,hash:createHash("sha256").update(readFileSync(`${path}/${entry}`)).digest("hex")}))
  }
})
