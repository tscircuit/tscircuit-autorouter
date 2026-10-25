import {expect,test} from "bun:test"
import {readFileSync} from "node:fs"
import {gunzipSync} from "node:zlib"
import {createHash} from "node:crypto"
import {PreloadedTraceGraphSolver} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/PreloadedTraceGraphSolver"
import {renderAm3352ResetWitnessSvg} from "../../scripts/benchmarks/render-am3352-reset-witness"
test("AM3352 fixed-copper preload preserves every boundary and port assignment",async()=>{
  const input=JSON.parse(gunzipSync(readFileSync(import.meta.dir+"/fixtures/am3352-reset-preload/stage-input.json.gz")).toString())
  const solver=new PreloadedTraceGraphSolver(input.sharedEdgeSegments,input.srj)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(createHash("sha256").update(JSON.stringify(solver.getOutput())).digest("hex")).toBe("972aac01ef37571ba7be42ec0db9c4abc817ab8f50430e0aeb6176e723acebde")
  await expect(renderAm3352ResetWitnessSvg()).toMatchSvgSnapshot(import.meta.path)
})
