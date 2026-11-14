import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

// Build beside the repro so imports and Manifold's relative WASM lookup agree.
const sourceRoot = resolve(process.argv[2] ?? process.env.FULL_BOARD_CORE_SOURCE ?? "../../tscircuit-core")
const output = join(import.meta.dir,"patched-core")
mkdirSync(output,{recursive:true})
for (const entry of ["lib/index.ts","lib/utils/copper-pour-connectivity/find-floating-copper.ts"]) {
  const child=Bun.spawn([process.execPath,"build",entry,"--target","bun","--outdir",output,
    "--external","@tscircuit/capacity-autorouter","--external","react","--external","react/jsx-runtime","--external","react/jsx-dev-runtime"],
    {cwd:sourceRoot,stdout:"inherit",stderr:"inherit"})
  if(await child.exited!==0)throw new Error(`Core build failed for ${entry}`)
}
copyFileSync(join(sourceRoot,"node_modules/manifold-3d/manifold.wasm"),join(output,"manifold.wasm"))
const commit=Bun.spawn(["git","rev-parse","HEAD"],{cwd:sourceRoot,stdout:"pipe"})
const coreCommit=(await new Response(commit.stdout).text()).trim()
if(await commit.exited!==0)throw new Error("Cannot record the core source revision")
writeFileSync(join(output,"build.json"),JSON.stringify({coreCommit,coreVersion:JSON.parse(readFileSync(join(sourceRoot,"package.json"),"utf8")).version},null,2))
