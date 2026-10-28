import { createHash } from "node:crypto"
import { resolve, join } from "node:path"
import assert from "node:assert/strict"
import { gunzipSync } from "node:zlib"
import { loadCapturedForestRegion } from "../../tests/fixtures/physical-forest-regional/loadCapturedForestRegion"

async function verifyPackagedControls(): Promise<void> {
  const report = await Bun.file(new URL("./RESULTS-V3.json", import.meta.url)).json()
  const manifestUrl = new URL(report.packagedRawManifest, import.meta.url)
  const manifest = await Bun.file(manifestUrl).json()
  let verifiedRows = 0
  let verifiedParts = 0
  for (const proof of manifest.archives) {
    const rows = []
    for (const part of proof.parts) {
      const compressed = Buffer.from(await Bun.file(new URL(part.path, manifestUrl)).arrayBuffer())
      assert.equal(compressed.length, part.compressedBytes)
      assert.equal(createHash("sha256").update(compressed).digest("hex"), part.compressedSha256)
      const rawPart = gunzipSync(compressed)
      assert.equal(rawPart.length, part.uncompressedBytes)
      assert.equal(createHash("sha256").update(rawPart).digest("hex"), part.uncompressedSha256)
      const row = JSON.parse(rawPart.toString("utf8"))
      assert.deepEqual([row.dataset, row.number, row.enabled], [part.dataset, part.sample, part.forest])
      rows.push(row)
      verifiedParts++
    }
    const raw = Buffer.from(JSON.stringify(rows, null, 2))
    assert.equal(raw.length, proof.uncompressedBytes)
    assert.equal(createHash("sha256").update(raw).digest("hex"), proof.uncompressedSha256)
    if (process.argv[3]) await Bun.write(join(process.argv[3], proof.logicalPath), raw)
    assert.equal(rows.length, 4)
    for (const row of rows) {
      const control = report.controls.find((item: any) =>
        item.dataset === row.dataset && item.sample === row.number && item.forest === row.enabled)
      assert.ok(control, "Archived row must belong to the original matched controls")
      const expected = proof.arm === "legacy" ? control.before : control.after
      assert.equal(row.inputSha256, control.inputSha256)
      assert.equal(row.outputSha256, expected.outputSha256)
      assert.equal(row.ledger.candidateClocks, expected.candidateClocks)
      assert.equal(row.ledger.a13RoutingIterations, expected.a13KernelIterations)
      const families = Object.values(row.ledger.families) as Array<{
        count: number; candidateIterations: number; a13RoutingIterations: number
      }>
      assert.equal(families.reduce((sum, value) => sum + value.count, 0), row.ledger.candidateCount)
      assert.equal(families.reduce((sum, value) => sum + value.candidateIterations, 0), row.ledger.candidateClocks)
      assert.equal(families.reduce((sum, value) => sum + value.a13RoutingIterations, 0), row.ledger.a13RoutingIterations)
      assert.equal(row.solved, true)
      assert.equal(row.failed, false)
      assert.equal(row.thrown, null)
      assert.deepEqual(row.referenceDrcErrors, [])
      assert.deepEqual(row.boardDrcErrors, [])
      assert.deepEqual(row.declaredDrcErrors, [])
      assert.equal(row.traces.length, row.traceCount)
      verifiedRows++
    }
  }
  assert.equal(verifiedRows, 8)
  const fixtureNames = Object.keys(report.packagedCapturedNodeFixtures).sort() as Array<Parameters<typeof loadCapturedForestRegion>[0]>
  assert.deepEqual(fixtureNames, ["cmn_42", "cmn_57"])
  for (const name of fixtureNames) {
    const input = loadCapturedForestRegion(name)
    assert.equal(input.nodePortPoints.length, 1)
    assert.equal(input.nodePortPoints[0]!.capacityMeshNodeId, name)
  }
  console.log(JSON.stringify({ verifiedArchives: manifest.archives.length, verifiedParts, verifiedRows,
    verifiedCapturedNodeFixtures: fixtureNames.length }))
}

if (process.argv[2] === "--verify-packaged") {
  await verifyPackagedControls()
  process.exit(0)
}

// Run each source revision in its own process, from that worktree's root.
const arm=process.argv[2] ?? "current"
const worktree=resolve(process.argv[3] ?? ".")
const outputFile=process.argv[4] ?? join(worktree,"experiments/physical-net-forest/raw",`REGIONAL-CONTROLS-${arm}.json`)
const {AutoroutingPipelineSolver9_PreloadedTraceGraph:Pipeline}=await import(join(worktree,"lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph.ts"))
const {PortfolioSingleIntraNodeSolver:Portfolio}=await import(join(worktree,"lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver.ts"))
const {loadScenarioBySampleNumber}=await import(join(worktree,"scripts/benchmark/scenarios.ts"))
const {evaluateRelaxedDrc}=await import(join(worktree,"lib/testing/evaluate-relaxed-drc.ts"))
const candidates=new Map<any,string>()
let activePhase='setup'
const generate=Portfolio.prototype.generateSolver
Portfolio.prototype.generateSolver=function(...args:any[]){const solver=generate.apply(this,args as any);candidates.set(solver,activePhase);return solver}
function ledger(){const phases:any={},families:any={};let clocks=0,a13Routing=0;for(const[s,phase]of candidates){const name=s.constructor.name;const bucket=families[name]??={count:0,candidateIterations:0,a13RoutingIterations:0,finalConfiguredCeiling:0};const pb=phases[phase]??={candidateIterations:0,a13RoutingIterations:0};bucket.count++;bucket.candidateIterations+=s.iterations;pb.candidateIterations+=s.iterations;bucket.finalConfiguredCeiling+=s.MAX_ITERATIONS;clocks+=s.iterations;if(typeof s.routingIterations==='number'){bucket.a13RoutingIterations+=s.routingIterations;pb.a13RoutingIterations+=s.routingIterations;a13Routing+=s.routingIterations}}return{candidateClocks:clocks,a13RoutingIterations:a13Routing,candidateCount:candidates.size,phases,families}}
const rows=[]
for(const[dataset,number]of[["srj18",5],["srj24",25]]as const)for(const enabled of[false,true]){
candidates.clear()
const {scenario}=await loadScenarioBySampleNumber(dataset,number)
const p=new Pipeline(structuredClone(scenario),{cacheProvider:null,effort:1,usePhysicalNetForest:enabled})
let thrown:string|null=null
try{while(!p.solved&&!p.failed){activePhase=p.getCurrentPhase();p.step()}}catch(error){thrown=String(error)}
let traces:any[]=[],outputHash:string|null=null,referenceErrors:any[]=[],boardErrors:any[]=[],declaredErrors:any[]=[]
if(p.solved&&!thrown){traces=p.getOutputSimplifiedPcbTraces();outputHash=createHash('sha256').update(JSON.stringify(p.getOutputSimpleRouteJson())).digest('hex');const args={inputSrj:scenario,srjWithPointPairs:p.srjWithPointPairs!,routedTraces:traces};referenceErrors=evaluateRelaxedDrc(args).errors;boardErrors=evaluateRelaxedDrc({...args,includeBoardClearance:true}).errors;declaredErrors=evaluateRelaxedDrc({...args,includeBoardClearance:true,drcOptions:{traceClearance:scenario.minTraceToPadEdgeClearance,viaClearance:scenario.minViaHoleEdgeToViaHoleEdgeClearance}}).errors}
const result={arm,dataset,number,enabled,inputSha256:createHash('sha256').update(JSON.stringify(scenario)).digest('hex'),solved:p.solved,failed:p.failed,error:p.error,thrown,forest:p.physicalNetForestSolver?.diagnostics,iterations:p.iterations,hdIterations:p.highDensityRouteSolver?.iterations,hdStats:p.highDensityRouteSolver?.stats,ledger:ledger(),outputSha256:outputHash,traceCount:traces.length,referenceDrcErrors:referenceErrors,boardDrcErrors:boardErrors,declaredDrcErrors:declaredErrors,repair:p.pipeline9JointDrcRepairSolver?.stats,traces}
rows.push(result)
console.log(JSON.stringify({...result,ledger:{candidateClocks:result.ledger.candidateClocks,a13RoutingIterations:result.ledger.a13RoutingIterations,phases:result.ledger.phases},traces:undefined,repair:undefined}))
}
await Bun.write(outputFile,JSON.stringify(rows,null,2))
