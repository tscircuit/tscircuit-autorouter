import { expect, test } from "bun:test"

test("optional A13 backend imports without WebAssembly or atob and preserves native public eligibility", (): void => {
  for (const missing of [["WebAssembly"], ["atob"], ["WebAssembly", "atob"]]) {
    const moduleUrl = new URL("../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/createParallelNativeA13SearchInstaller.ts", import.meta.url).href
    const source = `for(const name of ${JSON.stringify(missing)})Reflect.deleteProperty(globalThis,name);` +
      `const {createParallelNativeA13SearchInstaller}=await import(${JSON.stringify(moduleUrl)});` +
      `if(createParallelNativeA13SearchInstaller({}).install({},{}))throw new Error('public admission');`
    const result = Bun.spawnSync([process.execPath, "-e", source], { cwd: process.cwd() })
    expect(new TextDecoder().decode(result.stderr)).toBe("")
    expect(result.exitCode).toBe(0)
  }
})
