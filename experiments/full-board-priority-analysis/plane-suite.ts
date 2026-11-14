import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { cpus, totalmem } from "node:os"

type Task = { id: string; mode: "phased" | "fanout" }
const output = resolve(process.argv[2])
mkdirSync(output, { recursive: true })
const coreModule = join(import.meta.dir,"patched-core/index.js")
const copperModule = join(import.meta.dir,"patched-core/find-floating-copper.js")
const environment = { ...process.env, FULL_BOARD_CORE_MODULE: coreModule, FULL_BOARD_COPPER_MODULE: copperModule }
const revision=Bun.spawnSync(["git","rev-parse","HEAD"],{cwd:import.meta.dir})
if(revision.exitCode!==0)throw new Error("Cannot record the benchmark revision")
const routerCommit=new TextDecoder().decode(revision.stdout).trim()
environment.FULL_BOARD_ROUTER_COMMIT=routerCommit
writeFileSync(join(output,"environment.json"),JSON.stringify({bun:Bun.version,arch:process.arch,cpu:cpus()[0].model,cpus:cpus().length,memory:totalmem(),concurrency:2,
  routerCommit,coreBase:"40b8f45f0e3d55dcaa13a8389db4c4f1003019aa",coreFix:"24040b0",routingBudgetMs:600000,hardProcessBudgetMs:660000},null,2))
const modes=process.argv[3]==="phased"?["phased"]:["phased","fanout"]
const queue: Task[] = modes.flatMap((mode)=>["h616","icepi","glider","orangecrab","butterstick","imx6"].map((id)=>({id,mode:mode as Task["mode"]})))
const rows: unknown[] = []
async function worker(): Promise<void> {
  while (queue.length) {
    const task = queue.shift()!
    const folder = join(output,`${task.id}-${task.mode}`)
    mkdirSync(folder,{recursive:true})
    const log = openSync(join(folder,"worker.log"),"w")
    const started = performance.now()
    const child = Bun.spawn([process.execPath,"render.tsx",task.id,folder,task.mode],{cwd:import.meta.dir,env:environment,stdout:log,stderr:log})
    let timedOut=false,peakRssKb=0
    const memory = setInterval(()=>{
      try {
        const match=/VmHWM:\s+(\d+)/.exec(readFileSync(`/proc/${child.pid}/status`,"utf8"))
        if(match)peakRssKb=Math.max(peakRssKb,Number(match[1]))
      } catch { /* /proc vanishes when the child exits. */ }
    },1000)
    const timer=setTimeout(()=>{timedOut=true;child.kill("SIGKILL")},660000)
    const exitCode=await child.exited
    clearTimeout(timer);clearInterval(memory);closeSync(log)
    const processResult={...task,exitCode,timedOut,wallMs:performance.now()-started,peakRssMb:peakRssKb/1024}
    writeFileSync(join(folder,"process.json"),JSON.stringify(processResult,null,2))
    const auditLog=openSync(join(folder,"audit.log"),"w")
    const audit=Bun.spawn([process.execPath,"assess.ts",task.id,folder],{cwd:import.meta.dir,env:environment,stdout:auditLog,stderr:auditLog})
    let auditTimedOut=false
    const auditTimer=setTimeout(()=>{auditTimedOut=true;audit.kill("SIGKILL")},180000)
    const auditExitCode=await audit.exited
    clearTimeout(auditTimer);closeSync(auditLog)
    const progress=existsSync(join(folder,"progress.json"))?JSON.parse(readFileSync(join(folder,"progress.json"),"utf8")):null
    const assessment=existsSync(join(folder,"assessment.json"))?JSON.parse(readFileSync(join(folder,"assessment.json"),"utf8")):null
    const row={...processResult,auditExitCode,auditTimedOut,progress,assessment}
    rows.push(row);writeFileSync(join(output,"summary.json"),JSON.stringify(rows,null,2))
    console.log("PLANE_CASE_RESULT "+JSON.stringify({...row,assessment:assessment?{...assessment,missingCopper:assessment.missingCopper.slice(0,10)}:null}))
  }
}
await Promise.all([worker(),worker()])
console.log("PLANE_FIX_SUMMARY_BEGIN")
console.log(JSON.stringify({environment:JSON.parse(readFileSync(join(output,"environment.json"),"utf8")),cases:rows}))
console.log("PLANE_FIX_SUMMARY_END")
