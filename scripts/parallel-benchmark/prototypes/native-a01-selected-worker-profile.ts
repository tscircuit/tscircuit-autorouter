import { createHash } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { resolve } from "node:path"
import type { SamplingProfile } from "bun:jsc"
import type { Pipeline9ParallelHighDensityNodeJob,Pipeline9LocalWorkerResponse } from "../../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelWorkerTypes"

const jobPath=process.env.A01_PROFILE_JOB,sourceRoot=process.env.A01_PROFILE_ROOT
if(!jobPath||!sourceRoot) throw new Error("A01_PROFILE_JOB and A01_PROFILE_ROOT must identify the captured job and frozen source")
const directory=resolve(process.env.A01_PROFILE_OUTPUT??"/tmp/native-a01-selected-worker-profile")
await mkdir(directory,{recursive:true})
const bytes=new Uint8Array(await Bun.file(jobPath).arrayBuffer())
const json=jobPath.endsWith(".gz")?Bun.gunzipSync(bytes):bytes
const job=JSON.parse(new TextDecoder().decode(json)) as Pipeline9ParallelHighDensityNodeJob
if(job.kind!=="highDensityNode") throw new Error("The profile requires one actual captured ordinary HD worker job")
const worker=new Worker(new URL("./native-a01-selected-worker-profile.worker.ts",import.meta.url).href)
const result=await new Promise<{response:Pipeline9LocalWorkerResponse;report:SamplingProfile}>((resolveResult,reject):void=>{
  worker.onerror=(event:ErrorEvent):void=>reject(new Error(event.message))
  worker.onmessage=(event:MessageEvent):void=>{
    const message=event.data
    if(message.error) {reject(new Error(message.error));return}
    if(message.kind==="requestMultiHeadHistories"||message.kind==="requestGridHistories"||message.kind==="requestFirstValidA13Candidate") {
      const kind=message.kind==="requestMultiHeadHistories"?"multiHeadHistoryGrant":
        message.kind==="requestGridHistories"?"gridHistoryGrant":"firstValidA13CandidateGrant"
      worker.postMessage({kind,taskId:message.taskId,requestId:message.requestId,admittedCandidateIds:[],admitted:false})
      return
    }
    if(typeof message.kind==="string"&&message.kind.startsWith("cancel")) return
    resolveResult(message)
  }
  worker.postMessage({taskId:1,idleWorkerAvailability:new SharedArrayBuffer(4),job})
}).finally(():void=>worker.terminate())
if(!("ok" in result.response)||!result.response.ok) throw new Error("The captured actual worker task did not complete")
await Bun.write(`${directory}/profile.json`,JSON.stringify(result.report))
await Bun.write(`${directory}/functions.txt`,result.report.functions)
await Bun.write(`${directory}/result.json`,JSON.stringify(result.response,null,2))
const traces=result.report.stackTraces.traces,self=new Map<string,number>(),inclusive=new Map<string,number>()
for(const trace of traces) {
  const name=trace.frames[0]?.name??""
  self.set(name,(self.get(name)??0)+1)
  const names=new Set(trace.frames.map((frame)=>frame.name))
  for(const frameName of names) inclusive.set(frameName,(inclusive.get(frameName)??0)+1)
}
const hotspots=[...inclusive].map(([name,count])=>({name,selfSamples:self.get(name)??0,
  inclusiveSamples:count,inclusiveShare:count/traces.length})).sort((a,b)=>b.inclusiveSamples-a.inclusiveSamples)
const summary={kind:"actual-selected-worker-cpu-attribution",noTimingComparison:true,
  frozenSourceRoot:sourceRoot,nodeId:job.nodeWithPortPoints.capacityMeshNodeId,nodePf:job.nodePf,
  jobSha256:createHash("sha256").update(json).digest("hex"),rawStackSamples:traces.length,
  helperHistoriesAdmitted:0,hotspots}
await Bun.write(`${directory}/summary.json`,JSON.stringify(summary,null,2))
console.log(JSON.stringify({...summary,hotspots:hotspots.slice(0,20)},null,2))
