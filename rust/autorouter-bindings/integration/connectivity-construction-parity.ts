import assert from "node:assert/strict"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getConnectivityMapFromSimpleRouteJson } from "../../../lib/utils/getConnectivityMapFromSimpleRouteJson"
import type { SimpleRouteJson } from "../../../lib/types"
import { importReference } from "./tsReference"
const { getConnectivityMapFromSimpleRouteJson: reference } = await importReference<{getConnectivityMapFromSimpleRouteJson: typeof getConnectivityMapFromSimpleRouteJson}>("lib/utils/getConnectivityMapFromSimpleRouteJson.ts")

function snapshot(map: ConnectivityMap): unknown {
  const arrays = Object.values(map.netMap)
  return { netMap: Object.entries(map.netMap), idToNetMap: Object.entries(map.idToNetMap),
    aliases: arrays.map(left => arrays.map(right => left === right)),
    fields: Object.keys(map), netPrototype: Object.getPrototypeOf(map.netMap), idPrototype: Object.getPrototypeOf(map.idToNetMap) }
}
function compare(input: SimpleRouteJson, label: string): void {
  const call = (build: typeof reference): {map?: ConnectivityMap; error?: unknown} => {
    try { return {map: build(structuredClone(input))} } catch (error) { return {error} }
  }
  const expected = call(reference), actual = call(getConnectivityMapFromSimpleRouteJson)
  if (expected.error || actual.error) {
    assert.ok(expected.error instanceof Error && actual.error instanceof Error, label)
    assert.equal(actual.error.name, expected.error.name, label)
    assert.equal(actual.error.message, expected.error.message, label)
  } else {
    assert.ok(actual.map instanceof ConnectivityMap)
    assert.deepEqual(snapshot(actual.map!), snapshot(expected.map!), label)
    const retained = Object.values(actual.map!.netMap)[0]
    const expectedRetained = Object.values(expected.map!.netMap)[0]
    actual.map!.addConnections([["post-a", "post-b"], ["post-b", input.connections[0]?.name ?? "post-c"]])
    expected.map!.addConnections([["post-a", "post-b"], ["post-b", input.connections[0]?.name ?? "post-c"]])
    assert.deepEqual(snapshot(actual.map!), snapshot(expected.map!), `${label}: subsequent methods`)
    assert.deepEqual(retained, expectedRetained, `${label}: retained array`)
  }
  console.log(`${label}: constructor, aliases, methods or exact exception match`)
}
const base = {layerCount: 16, minTraceWidth: 0.1, bounds: {minX:-2,minY:-2,maxX:2,maxY:2}, connections: [], obstacles: []} as SimpleRouteJson
compare(base, "empty")
for (const name of ["a", "", "toString", "constructor", "__proto__", "hasOwnProperty", "x\ud800\0y", "😀"]) {
  for (const number of [NaN, Infinity, -Infinity, -0, 1e308, Number.MIN_VALUE]) {
  compare({...base, connections: [{name:"numeric",pointsToConnect:[{x:number,y:-number,layer:"top"}]}]}, `coordinate ${String(number)}`)
  compare({...base, layerCount:number, connections:[{name:"layers",pointsToConnect:[{x:0,y:0,layers:["top","bottom","inner10","inner2"]}]}]}, `layerCount ${String(number)}`)
}
compare({...base, connections: [{name, pointsToConnect: [{x:-0.005,y:0.005,layer:"top"}]}]}, `name ${JSON.stringify(name)}`)
}
compare({...base, connections: [
  {name:"a", pointsToConnect:[{x:1e-10,y:-1e-10,layers:["inner2","inner10","bottom"]}]},
  {name:"b", pointsToConnect:[{x:1.005,y:-1.005,layer:"bottom"}]},
  {name:"c", __rootConnectionNames:["a","b"], __netConnectionName:"whole", pointsToConnect:[]},
  {name:"d", __rootConnectionNames:["b","a"], pointsToConnect:[]},
],obstacles:[{type:"rect",center:{x:0,y:0},width:1,height:1,layers:["top"],connectedTo:["a","a","b"],offBoardConnectsTo:["d"],obstacleId:"pad"}]},"ordered merges and layer sort")
Object.defineProperty(Object.prototype,"nativeConnectivityAlias",{value:"connectivity_net0",writable:true,configurable:true})
try {
  compare({...base,connections:[{name:"normal",pointsToConnect:[{x:0,y:0,layer:"top"}]},{name:"nativeConnectivityAlias",pointsToConnect:[{x:1,y:1,layer:"top"}]}]},"inherited string alias")
} finally { delete (Object.prototype as Record<string,unknown>).nativeConnectivityAlias }
const dataset = await import("dataset-srj18")
for (const [name,input] of Object.entries(dataset)) if (/^sample\d+$/.test(name)) compare(input as SimpleRouteJson,name)
