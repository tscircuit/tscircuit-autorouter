import { GeometryAutoroutingPipelineSolver } from "../../lib/testing/GeometryAutoroutingPipelineSolver"
import type { SimpleRouteJson } from "../../lib/types"
const [dataset = "18", sample = "1"] = process.argv.slice(2)
const root = dataset === "18" ? "dataset-srj18" : "@tscircuit/dataset-srj24"
const path = `${process.cwd()}/node_modules/${root}/samples/sample${sample.padStart(3,"0")}.json`
const srj: SimpleRouteJson = await Bun.file(path).json()
const solver = new GeometryAutoroutingPipelineSolver(srj)
const before = performance.now()
let error: string | null = null
console.error = (...args): void => { process.stderr.write(`${String(args[0]).slice(0,500)}\n`) }
try { while(!solver.solved && !solver.failed) { solver.step(); if(solver.iterations%20===0) process.stderr.write(JSON.stringify({step:solver.iterations,routed:solver.traces.length,reorders:solver.stats.conflictReorders})+"\n") } } catch (e) { error = String(e) }
console.log(JSON.stringify({ dataset, sample, solved:solver.solved, failed:solver.failed,error:error?.slice(0,3000),ms:performance.now()-before,stats:solver.stats,traceCount:solver.traces.length }))
