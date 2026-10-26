import {createHash} from "node:crypto"
import {writeFileSync,mkdirSync} from "node:fs"
import {MultiTargetNecessaryCrampedPortPointSolver} from "lib/solvers/NecessaryCrampedPortPointSolver/MultiTargetNecessaryCrampedPortPointSolver"
import {createCrampedPortSetupInput} from "../../tests/fixtures/createCrampedPortSetupInput"

const count=Number(process.argv[2]??128)
if(!Number.isSafeInteger(count)||count<1)throw Error("Expected a positive port count")
const trials=[];let report:Record<string,unknown>|undefined
for(let trial=0;trial<4;trial++) {
  const fixture=createCrampedPortSetupInput(count),before=JSON.stringify(fixture.input.sharedEdgeSegments),readsBefore=fixture.nodeIdReads
  const started=performance.now(),solver=new MultiTargetNecessaryCrampedPortPointSolver(fixture.input)
  solver.step()
  const setupMs=performance.now()-started,setupReads=fixture.nodeIdReads-readsBefore
  solver.solve()
  if(!solver.solved)throw Error(solver.error??"Native multi-target graph did not solve")
  const output=JSON.stringify(solver.getOutput())
  if(JSON.stringify(fixture.input.sharedEdgeSegments)!==before)throw Error("Native shared graph changed")
  if(trial>0)trials.push(setupMs)
  report={scope:"Native multi-target graph setup and candidate control; full PCB DRC measured separately",count,ports:fixture.portCount,solved:solver.solved,failed:solver.failed,setupPortNodeIdReads:setupReads,inputUnchanged:true,inputSha256:createHash("sha256").update(before).digest("hex"),outputSha256:createHash("sha256").update(output).digest("hex"),peakRssBytes:process.resourceUsage().maxRSS*1024}
  if(process.argv.includes("--visual")&&trial===3) {
    const {getSvgFromGraphicsObject}=await import("graphics-debug"),{Resvg}=await import("@resvg/resvg-js")
    const svg=getSvgFromGraphicsObject(solver.visualize())
    mkdirSync("docs/linear-cramped-port-setup",{recursive:true})
    writeFileSync("docs/linear-cramped-port-setup/completed-graph.svg",svg)
    writeFileSync("docs/linear-cramped-port-setup/completed-graph.png",new Resvg(svg).render().asPng())
  }
}
console.log(JSON.stringify({...report,medianSetupMs:[...trials].sort((a,b)=>a-b)[1],trialsSetupMs:trials},null,2))
