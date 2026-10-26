import {createHash} from "node:crypto"
import {mkdirSync,writeFileSync} from "node:fs"
import {AvailableSegmentPointSolver} from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import {createPortLookupInput} from "../../tests/fixtures/createPortLookupInput"

const count=Number(process.argv[2]??64)
if(!Number.isSafeInteger(count)||count<1)throw Error("Expected positive edge count")
const input=createPortLookupInput(count),inputHash=createHash("sha256").update(JSON.stringify(input)).digest("hex")
const started=performance.now(),solver=new AvailableSegmentPointSolver(input)
solver.solve()
const solveMs=performance.now()-started,solvePeakRssBytes=process.resourceUsage().maxRSS*1024
const hash=createHash("sha256");let ports=0
for(const segment of solver.getOutput()){ports+=segment.portPoints.length;hash.update(JSON.stringify(segment))}
if(inputHash!==createHash("sha256").update(JSON.stringify(input)).digest("hex"))throw Error("Input changed")
const port=solver.getOutput()[0]!.portPoints[0]!,before=JSON.stringify(solver.getOutput()[0]),lookupStarted=performance.now()
if(solver.portPointMap.get(port.segmentPortPointId)!==port)throw Error("Lookup did not retain native port identity")
if(!solver.assignPortPoint(port.segmentPortPointId,"signal")||solver.assignPortPoint(port.segmentPortPointId,"other")||!solver.releasePortPoint(port.segmentPortPointId))throw Error("Assignment/release failed")
if(JSON.stringify(solver.getOutput()[0])!==before)throw Error("Release changed output")
const lookupMs=performance.now()-lookupStarted
if(process.argv.includes("--visual")) {
 const {getSvgFromGraphicsObject}=await import("graphics-debug"),{Resvg}=await import("@resvg/resvg-js")
 const svg=getSvgFromGraphicsObject(solver.visualize());mkdirSync("docs/lazy-port-lookup-indexes",{recursive:true});writeFileSync("docs/lazy-port-lookup-indexes/completed-graph.svg",svg);writeFileSync("docs/lazy-port-lookup-indexes/completed-graph.png",new Resvg(svg).render().asPng())
}
console.log(JSON.stringify({scope:"Native available-port generation, then public lookup; full PCB DRC measured separately",count,ports,solved:solver.solved,failed:solver.failed,inputUnchanged:true,inputSha256:inputHash,outputSha256:hash.digest("hex"),solveMs,solvePeakRssBytes,lookupMs,finalPeakRssBytes:process.resourceUsage().maxRSS*1024},null,2))
