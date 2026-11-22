import { readFileSync, writeFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { createHash } from "node:crypto"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"

const head = process.argv[2] === "head"
const experiment = "/workspace/work/boards-benchmark-3252/experiments/boards-3273-no-pours"
const expected = JSON.parse(readFileSync(`${experiment}/base-autorouter-hash.json`, "utf8"))["index.js"]
Bun.plugin({name:"regional-cut-stage-replay",setup(build){
  build.onLoad({filter:/[/\\]@tscircuit[/\\]capacity-autorouter[/\\]dist[/\\]index\.js$/},({path})=>{
    const original=readFileSync(path,"utf8")
    if(createHash("sha256").update(original).digest("hex")!==expected)throw Error("Unexpected released autorouter")
    const before=readFileSync(`${experiment}/regional-padding-original.js`,"utf8")
    const after=readFileSync(`${experiment}/regional-padding.js`,"utf8")
    if(original.split(before).length!==2)throw Error("Regional cut site changed")
    let updated=original
    if(head){
      const start=original.indexOf(before)
      const end=original.indexOf("finishRegionalFallback(){",start)
      const scope=original.slice(start,end)
      const declaration=readFileSync(`${experiment}/regional-immutable-declaration.js`,"utf8")
      if(scope.split(declaration).length!==2)throw Error("Immutable-mode declaration changed")
      updated=original.slice(0,start)+scope.replace(declaration,"").replace(before,after)+original.slice(end)
    }
    return {contents:updated,loader:"js"}
  })
}})
const {Pipeline9HighDensitySolver}=await import("@tscircuit/capacity-autorouter")
const raw=gunzipSync(readFileSync(process.argv[3]!))
const captured=JSON.parse(raw.toString())
const solver=new Pipeline9HighDensitySolver({...captured,connMap:new ConnectivityMap(captured.connMap.netMap)})
const start=performance.now()
solver.solve()
const result={variant:head?"head":"base",inputSha256:createHash("sha256").update(raw).digest("hex"),seconds:(performance.now()-start)/1000,solved:solver.solved,error:solver.error,iterations:solver.iterations,routedFragments:solver.routes.length,stats:solver.stats}
writeFileSync(process.argv[4]!,JSON.stringify(result,null,2)+"\n")
console.log(JSON.stringify(result))
