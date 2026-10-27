import assert from "node:assert/strict"
import {mkdirSync,readFileSync,writeFileSync} from "node:fs"
import os from "node:os"

const sample = Number(process.argv[2] ?? 6)
const repeats = Number(process.argv[3] ?? 3)
const directory = process.argv[4] ?? "work/snapshot-benchmark"
const batchSize = Number(process.argv[5] ?? 8)
mkdirSync(directory,{recursive:true})
const orders = [["original","new1","new4"],["new4","original","new1"],["new1","new4","original"]]
const reports: any[] = []
for (let repeat = 0; repeat < repeats; repeat++) {
  for (const mode of orders[repeat % orders.length]!) {
    const path = `${directory}/${repeat}-${mode}.json`
    console.log(`Starting sample ${sample}, repetition ${repeat+1}, ${mode}`)
    const process = Bun.spawn([Bun.which("bun") ?? Bun.argv[0]!,new URL("./run.ts",import.meta.url).pathname,String(sample),mode,String(batchSize),path],{stdout:"pipe",stderr:"pipe",env:{...globalThis.process.env,PROTOTYPE_DOWNSTREAM:"0",PROTOTYPE_PROGRESS:""}})
    const [stdout,stderr,status] = await Promise.all([new Response(process.stdout).text(),new Response(process.stderr).text(),process.exited])
    writeFileSync(`${directory}/${repeat}-${mode}.log`,stdout+stderr)
    assert.equal(status,0,stderr+stdout)
    const report = JSON.parse(readFileSync(path,"utf8"))
    reports.push({...report,repeat})
    console.log(JSON.stringify({repeat,mode,seconds:report.elapsedMs/1000,cpuSeconds:report.cpuMs/1000,hash:report.hash}))
  }
}
const revised = reports.filter(report=>report.mode !== "original")
assert.equal(new Set(revised.map(report=>report.hash)).size,1,"Revised outputs differ across threads or repeats")
const expected = readFileSync(`${directory}/0-new1-output.json`)
for (const report of revised) {
  assert.deepEqual(readFileSync(`${directory}/${report.repeat}-${report.mode}-output.json`),expected)
  const {searchMs,mergeMs,...logicalStats} = report.batchStats
  const {searchMs:referenceSearchMs,mergeMs:referenceMergeMs,...referenceStats} = revised[0].batchStats
  assert.deepEqual(logicalStats,referenceStats,"Logical work differs across threads or repetitions")
}
const median = (values:number[]):number => [...values].sort((a,b)=>a-b)[Math.floor(values.length/2)]!
const summary = Object.fromEntries(orders[0]!.map(mode=>[mode,{medianMs:median(reports.filter(report=>report.mode===mode).map(report=>report.elapsedMs)),runsMs:reports.filter(report=>report.mode===mode).map(report=>report.elapsedMs)}]))
const result = {
  sample,repeats,batchSize,densityFactor:revised[0].densityFactor ?? 0,revision:Bun.spawnSync(["git","rev-parse","HEAD"]).stdout.toString().trim(),
  runtime:Bun.version,platform:process.platform,architecture:process.arch,cpu:os.cpus()[0]?.model,cpuQuota:readFileSync("/sys/fs/cgroup/cpu.max","utf8").trim(),
  summary,originalToNew4Speedup:summary.original!.medianMs/summary.new4!.medianMs,
  revisedThreadSpeedup:summary.new1!.medianMs/summary.new4!.medianMs,
  revisedSerialTimeRatio:summary.new1!.medianMs/summary.original!.medianMs,
  exactParity:true,revisedOutputHash:revised[0].hash,reports,
}
writeFileSync(`${directory}/summary.json`,JSON.stringify(result,null,2))
console.log(JSON.stringify(result,null,2))
