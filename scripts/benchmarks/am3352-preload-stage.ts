import {readFileSync,writeFileSync} from "node:fs"
import {gunzipSync,gzipSync} from "node:zlib"
import {createHash} from "node:crypto"
import {PreloadedTraceGraphSolver} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/PreloadedTraceGraphSolver"
const data=JSON.parse(gunzipSync(readFileSync("tests/features/fixtures/am3352-reset-preload/stage-input.json.gz")).toString()),start=performance.now(),solver=new PreloadedTraceGraphSolver(data.sharedEdgeSegments,data.srj)
solver.solve()
const seconds=(performance.now()-start)/1000,output=JSON.stringify(solver.getOutput()),report={seconds,solved:solver.solved,failed:solver.failed,stats:solver.stats,outputSha256:createHash("sha256").update(output).digest("hex")}
writeFileSync(process.argv[2],JSON.stringify(report,null,2)+"\n");writeFileSync(process.argv[2]+".output.json.gz",gzipSync(output));console.log(JSON.stringify(report))
