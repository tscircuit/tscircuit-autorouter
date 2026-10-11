import { expect, test } from "bun:test"
import { getParallelConnectivityMap } from "../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/getParallelConnectivityMap"
import { getConnectivityMapFromSimpleRouteJson } from "../lib/utils/getConnectivityMapFromSimpleRouteJson"
import type { SimpleRouteJson } from "../lib/types"

test("parallel connectivity construction preserves all sixteen pinned SRJ18 maps and shared net-array identities", async () => {
  for (let sample = 1; sample <= 16; sample++) {
    const srj = await Bun.file(new URL(`../node_modules/dataset-srj18/samples/sample${String(sample).padStart(3, "0")}.json`, import.meta.url)).json() as SimpleRouteJson
    const native = getConnectivityMapFromSimpleRouteJson(srj)
    const packed = getParallelConnectivityMap(srj)
    expect(packed.netMap).toEqual(native.netMap)
    expect(packed.idToNetMap).toEqual(native.idToNetMap)
    expect(Object.keys(packed.netMap)).toEqual(Object.keys(native.netMap))
    expect(Object.keys(packed.idToNetMap)).toEqual(Object.keys(native.idToNetMap))
    const nativeFirstAlias = new Map<string[], string>()
    const packedFirstAlias = new Map<string[], string>()
    for (const key of Object.keys(native.netMap)) {
      const nativeIds = native.netMap[key]!
      const packedIds = packed.netMap[key]!
      if (!nativeFirstAlias.has(nativeIds)) nativeFirstAlias.set(nativeIds, key)
      if (!packedFirstAlias.has(packedIds)) packedFirstAlias.set(packedIds, key)
      expect(packedFirstAlias.get(packedIds)).toBe(nativeFirstAlias.get(nativeIds))
    }
  }
})
