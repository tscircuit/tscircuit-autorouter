import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { cpus, availableParallelism, totalmem } from "node:os"

type Task = { id: string; kind: "full" | "board" | "bus"; variant: string; limitSeconds: number }
const output = resolve(process.argv[2] ?? "analysis-results")
mkdirSync(output, { recursive: true })
writeFileSync(join(output,"environment.json"),JSON.stringify({bun:Bun.version,arch:process.arch,platform:process.platform,cpu:cpus()[0].model,cpus:cpus().length,availableParallelism:availableParallelism(),memory:totalmem(),solverCommit:"c591de445efc25c305ac2967d3340cde7b6897c2",concurrency:4},null,2))
const full: Task[] = ["h616","icepi","orangecrab","glider","butterstick","imx6"].map((id)=>({id,kind:"full",variant:"baseline",limitSeconds:600}))
const diagnostic: Task[] = []
for (const id of ["h616","icepi","glider"]) for (const variant of ["baseline","compact_aliases","without_ground","without_large_nets"]) diagnostic.push({id,kind:"board",variant,limitSeconds:190})
for (const id of ["butterstick","imx6"]) for (const variant of ["baseline","compact_aliases"]) diagnostic.push({id,kind:"bus",variant,limitSeconds:190})
const rows: unknown[] = []
async function pool(queue: Task[]): Promise<void> {
  while (queue.length) {
    const task = queue.shift()!
    const folder = join(output,`${task.id}-${task.kind}-${task.variant}`)
    mkdirSync(folder,{recursive:true})
    const log = openSync(join(folder,"worker.log"),"w")
    const args = task.kind === "full"
      ? [process.execPath,join(import.meta.dir,"render.tsx"),task.id,folder,"phased"]
      : [process.execPath,"--cpu-prof",`--cpu-prof-dir=${folder}`,"--cpu-prof-name=cpu.cpuprofile",join(import.meta.dir,"replay.ts"),task.id,task.kind,task.variant,folder]
    const started = performance.now()
    const child = Bun.spawn(args,{cwd:import.meta.dir,stdout:log,stderr:log})
    let timedOut = false, peakRssKb = 0
    const memory = setInterval(()=>{
      try {
        const status=readFileSync(`/proc/${child.pid}/status`,"utf8")
        const match=/VmHWM:\s+(\d+)/.exec(status)
        if(match)peakRssKb=Math.max(peakRssKb,Number(match[1]))
      } catch { /* A process can exit between the /proc read and its exit event. */ }
    },1000)
    const timer=setTimeout(()=>{timedOut=true;child.kill("SIGKILL")},task.limitSeconds*1000)
    const exitCode=await child.exited
    clearTimeout(timer);clearInterval(memory);closeSync(log)
    const row={...task,exitCode,timedOut,wallMs:performance.now()-started,peakRssMb:peakRssKb/1024,cpuProfile:existsSync(join(folder,"cpu.cpuprofile"))}
    writeFileSync(join(folder,"process.json"),JSON.stringify(row,null,2))
    rows.push(row);writeFileSync(join(output,"processes.json"),JSON.stringify(rows,null,2))
    console.log(JSON.stringify(row))
  }
}
await Promise.all([pool(full),pool(full),pool(diagnostic),pool(diagnostic)])
