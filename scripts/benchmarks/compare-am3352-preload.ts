import {mkdirSync,readFileSync,writeFileSync} from "node:fs"
import {execFileSync,spawnSync} from "node:child_process"
const baseRef=process.argv[2]
if(!baseRef)throw Error("Supply the base revision to compare")
const sourcePath="lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/PreloadedTraceGraphSolver.ts"
const headSource=readFileSync(sourcePath),baseSource=execFileSync("git",["show",baseRef+":"+sourcePath])
const directory=".tscircuit/benchmarks/am3352-preload"
mkdirSync(directory,{recursive:true})
try{
  for(const [label,source] of [["base",baseSource],["head",headSource]] as const){
    writeFileSync(sourcePath,source)
    const result=spawnSync(process.execPath,["scripts/benchmarks/am3352-preload-stage.ts",directory+"/"+label+".json"],{stdio:"inherit",env:process.env})
    if(result.status!==0)throw Error("Stage benchmark failed for "+label)
  }
}finally{writeFileSync(sourcePath,headSource)}
const base=JSON.parse(readFileSync(directory+"/base.json","utf8")),head=JSON.parse(readFileSync(directory+"/head.json","utf8"))
const comparison={baseRef,headRef:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),base,head,identicalOutput:base.outputSha256===head.outputSha256,speedRatio:base.seconds/head.seconds}
writeFileSync(directory+"/comparison.json",JSON.stringify(comparison,null,2)+"\n")
const summary="# AM3352 fixed-copper preload\n\n| Revision | Seconds | Assignments | Complete output SHA |\n| --- | ---: | ---: | --- |\n| Base | "+base.seconds.toFixed(3)+" | "+base.stats.tracePortAssignmentCount+" | "+base.outputSha256+" |\n| Head | "+head.seconds.toFixed(3)+" | "+head.stats.tracePortAssignmentCount+" | "+head.outputSha256+" |\n\nIdentical complete boundary/port output: **"+comparison.identicalOutput+"**. One sequential pair on the same worker; this isolates preload latency, not whole-board solve rate.\n"
writeFileSync(directory+"/summary.md",summary)
console.log(summary)
if(process.env.GITHUB_STEP_SUMMARY)writeFileSync(process.env.GITHUB_STEP_SUMMARY,summary,{flag:"a"})
if(!comparison.identicalOutput)throw Error("Preloaded boundary/port output changed")
