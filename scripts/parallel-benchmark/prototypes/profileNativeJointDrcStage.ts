import { profile } from "bun:jsc"
import { createHash } from "node:crypto"
import { readFile, mkdir, writeFile } from "node:fs/promises"
import { gzipSync } from "node:zlib"
import { resolve } from "node:path"
const sourceRoot = process.env.JOINT_PROFILE_ROOT
const frozenRevision = process.env.JOINT_PROFILE_SHA
if (!sourceRoot || !frozenRevision) throw new Error("Specify immutable JOINT_PROFILE_ROOT and JOINT_PROFILE_SHA")
const { AutoroutingPipelineSolver9_Parallel } = await import(resolve(sourceRoot,"lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/AutoroutingPipelineSolver9_Parallel.ts"))

const sample = Number(process.argv[2] ?? 1)
const output = process.argv[3]!
const bytes = new Uint8Array(await readFile(resolve(sourceRoot,"node_modules/dataset-srj18/samples/sample")+String(sample).padStart(3,"0")+".json"))
const input = JSON.parse(new TextDecoder().decode(bytes))
const config = {effort:1,cacheProvider:null,workerCount:4,pathingStrategy:"indexed" as const,enableParallelDrcTrials:false,enableParallelPathSimplification:true}
const actual = new AutoroutingPipelineSolver9_Parallel(structuredClone(input),config)
const control = new AutoroutingPipelineSolver9_Parallel(structuredClone(input),config)
const hash = (x:unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex")
const phase = "pipeline9JointDrcRepairSolver"
async function runJoint(top: InstanceType<typeof AutoroutingPipelineSolver9_Parallel>) {
  if(top.getCurrentPhase()!==phase || top.activeSubSolver!==null)throw new Error("Must enter before actual stage construction")
  while(top.getCurrentPhase()===phase && !top.failed && !top.solved)await top.stepAsync()
  const joint=top.pipeline9JointDrcRepairSolver!
  if(top.failed || !joint?.solved || joint.failed)throw new Error(top.error??joint?.error??"Joint failed")
  return joint
}
function state(joint:any){return {geometry:hash(joint.getOutput()),iterations:joint.iterations,MAX_ITERATIONS:joint.MAX_ITERATIONS,progress:joint.progress,failed:joint.failed,solved:joint.solved,error:joint.error,indexedDrcEvaluationCount:joint.indexedDrcEvaluationCount,indexedDrcCacheHitCount:joint.indexedDrcCacheHitCount,referenceDrcValidationCount:joint.referenceDrcValidationCount,referenceDrcFalseNegativeCount:joint.referenceDrcFalseNegativeCount}}
try{
  await control.solveUntilPhaseAsync(phase)
  const original=await runJoint(control)
  const originalState=state(original)
  await actual.solveUntilPhaseAsync(phase)
  var final:any
  const report=await profile(async()=>{ final=await runJoint(actual) },1000)
  const actualState=state(final)
  if(JSON.stringify(actualState)!==JSON.stringify(originalState))throw new Error("Unmodified frozen joint state mismatch")
  const self=new Map<string,number>(), inclusive=new Map<string,number>()
  for(const trace of report.stackTraces.traces){const first=trace.frames[0]?.name??"";self.set(first,(self.get(first)??0)+1);for(const name of new Set(trace.frames.map(f=>f.name)))inclusive.set(name,(inclusive.get(name)??0)+1)}
  const hotSpots=[...inclusive].map(([name,samples])=>({name,selfSamples:self.get(name)??0,inclusiveSamples:samples,inclusiveShare:samples/report.stackTraces.traces.length})).sort((a,b)=>b.inclusiveSamples-a.inclusiveSamples)
  const sourceFiles=["lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPipeline9JointDrcRepairSolver.ts","lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver.ts","lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/repair03/Pipeline9MemoizedAutoroutingDrcEngine.ts","lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/createMemoizedReferenceDrcEvaluator.ts"]
  const sourceHashes=Object.fromEntries(await Promise.all(sourceFiles.map(async p=>[p,createHash("sha256").update(new Uint8Array(await readFile(resolve(sourceRoot,p)))).digest("hex")])))
  await mkdir(output,{recursive:true});const raw=new Uint8Array(gzipSync(JSON.stringify(report)));await writeFile(output+"/profile.json.gz",raw)
  const summary={kind:"actual-unmodified-frozen-joint-stage-main-cpu-attribution",frozenRevision,sample,noTimingComparison:true,profileScope:"Original actual parent-stage construction, preparation and complete ordered native solve; earlier-stage preparation and control excluded; worker CPU excluded",inputSha256:createHash("sha256").update(bytes).digest("hex"),sourceHashes,profileSha256:createHash("sha256").update(raw).digest("hex"),samples:report.stackTraces.traces.length,control:originalState,actual:actualState,hotSpots}
  await writeFile(output+"/summary.json",JSON.stringify(summary,null,2)+"\n")
  console.log(JSON.stringify({...summary,hotSpots:hotSpots.slice(0,22)},null,2))
} finally {control.dispose();actual.dispose()}
