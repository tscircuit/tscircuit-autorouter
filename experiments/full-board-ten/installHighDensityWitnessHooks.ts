import { createHash } from "node:crypto"

export const EXPECTED_AUTOROUTER_ENTRY_SHA256 =
  "f5b61e425777bf4bceae861464583b8aa32db01439ce99c817b832adb39a5716"

export type HighDensityWitnessAnchor = {
  name:
    | "preloaded-via-conflict"
    | "parent-copper-conflict"
    | "single-route-options"
  original: string
  replacement: string
  offset: number
}

const sha256 = (source: string): string =>
  createHash("sha256").update(source, "utf8").digest("hex")

// These strings describe the published AR1111 entry, not a rebuilt solver.
const viaPredicatePrefix = [
  "Vie=({routes:e,movablePreloadedConnectionNames:t,boardObstacles:n,connMap:o,layerCount:i,viaToPadClearance:r,allowBlindAndBuriedVias:s})=>e.some(e=>{",
  "if(!t.has(e.connectionName))return!1;return cs(e,{layerCount:i,allowBlindAndBuriedVias:s}).viaSpans.some(t=>n.some(n=>{",
  "if((({obstacle:e,route:t,connMap:n})=>{if(bo(e,t,n))return!0;if(!t.rootConnectionName)return!1;",
  "const o=n.getNetConnectedToId(t.connectionName)??n.getNetConnectedToId(t.rootConnectionName)??(n.netMap[t.rootConnectionName]?t.rootConnectionName:void 0);",
  "return!!o&&e.connectedTo.some(e=>(n.getNetConnectedToId(e)??(n.netMap[e]?e:void 0))===o)})({obstacle:n,route:e,connMap:o}))return!1;",
].join("")

const obstacleLayersExpression =
  "((e,t)=>{const n=e.__zLayers??e.zLayers;return n||e.layers.map(e=>po(e,t))})(n,i)"

const obstacleDistanceExpression = [
  '((e,t)=>{if("circle"===t.shape)return Math.max(0,Math.hypot(e.x-t.center.x,e.y-t.center.y)-t.width/2);',
  "const n=-1*(t.ccwRotationDegrees??0)*Math.PI/180,o=e.x-t.center.x,i=e.y-t.center.y,",
  "r=o*Math.cos(n)-i*Math.sin(n),s=o*Math.sin(n)+i*Math.cos(n),",
  "a=Math.max(Math.abs(r)-t.width/2,0),c=Math.max(Math.abs(s)-t.height/2,0);return Math.hypot(a,c)})(t.center,n)",
].join("")

const originalViaPredicate = [
  viaPredicatePrefix,
  `const s=${obstacleLayersExpression};`,
  "return!!s.some(e=>e>=t.minZ&&e<=t.maxZ)&&",
  `${obstacleDistanceExpression}<t.diameter/2+r}))})`,
].join("")

const observedViaPredicate = [
  viaPredicatePrefix,
  // Avoid shadowing the outer `s`, which is the actual blind/buried-via option.
  `const hdWitnessObstacleZLayers=${obstacleLayersExpression};`,
  "if(!hdWitnessObstacleZLayers.some(e=>e>=t.minZ&&e<=t.maxZ))return!1;",
  `const hdWitnessActualDistance=${obstacleDistanceExpression};`,
  "const hdWitnessRequiredDistance=t.diameter/2+r;",
  "const hdWitnessConflict=hdWitnessActualDistance<hdWitnessRequiredDistance;",
  // Diagnostic exceptions must not alter the original routing decision.
  'if(hdWitnessConflict){try{globalThis.__tscircuitHdWitness?.({event:"preloaded-via-conflict",',
  "route:e,via:t,obstacle:n,obstacleZLayers:hdWitnessObstacleZLayers,layerCount:i,",
  "allowBlindAndBuriedVias:s,viaToPadClearance:r,actualDistance:hdWitnessActualDistance,",
  "requiredDistance:hdWitnessRequiredDistance,connMap:o})}catch{}}",
  "return hdWitnessConflict}))})",
].join("")

const parentConflictPrefix = [
  "for(const e of i)for(const t of r)ds(e,t,this.connMap)||",
  "ps({left:e,right:t,clearance:this.obstacleMargin,leftBounds:s,layerCount:this.layerCount,",
  "allowBlindAndBuriedVias:this.allowBlindAndBuriedVias})&&",
].join("")

const originalParentConflict =
  `${parentConflictPrefix}a.set(t.connectionName,t);`

const observedParentConflict = [
  parentConflictPrefix,
  '((()=>{try{globalThis.__tscircuitHdWitness?.({event:"parent-copper-conflict",parent:this,',
  "left:e,right:t,clearance:this.obstacleMargin,leftBounds:s,layerCount:this.layerCount,",
  "allowBlindAndBuriedVias:this.allowBlindAndBuriedVias,connMap:this.connMap})}catch{}})(),",
  "a.set(t.connectionName,t));",
].join("")

const singleRouteOptionsPrefix =
  "getSingleRouteSolverOpts(e){const{connectionName:t,rootConnectionName:n,points:o}=e;"

const singleRouteOptionsObject = [
  "{connectionName:t,rootConnectionName:n,regionId:this.nodeWithPortPoints.capacityMeshNodeId,",
  "minDistBetweenEnteringPoints:this.minDistBetweenEnteringPoints,bounds:io(this.nodeWithPortPoints),",
  "A:{x:o[0].x,y:o[0].y,z:o[0].z},B:{x:o[o.length-1].x,y:o[o.length-1].y,z:o[o.length-1].z},",
  "obstacleRoutes:this.connMap?this.solvedRoutes.filter(e=>!this.connMap.areIdsConnected(e.connectionName,t)):this.solvedRoutes,",
  "futureConnections:this.unsolvedConnections,layerCount:this.nodeWithPortPoints.portPoints.reduce((e,t)=>Math.max(e,(t.z??0)+1),2),",
  "availableZ:this.nodeWithPortPoints.availableZ&&this.nodeWithPortPoints.availableZ.length>0?",
  "this.nodeWithPortPoints.availableZ:[...new Set(this.nodeWithPortPoints.portPoints.map(e=>e.z??0))].sort((e,t)=>e-t),",
  "hyperParameters:this.hyperParameters,connMap:this.connMap,viaDiameter:this.viaDiameter,",
  "traceThickness:this.traceWidth,obstacleMargin:this.obstacleMargin,captureSearchDebug:this.captureSearchDebug}",
].join("")

const originalSingleRouteOptions =
  `${singleRouteOptionsPrefix}return${singleRouteOptionsObject}}`

const observedSingleRouteOptions = [
  singleRouteOptionsPrefix,
  // Construct the original object once and return that same object unchanged.
  `const hdWitnessOptions=${singleRouteOptionsObject};`,
  'if(this.nodeWithPortPoints.capacityMeshNodeId==="topology_merge_17108"){',
  'try{globalThis.__tscircuitHdWitness?.({event:"single-route-options",solver:this,options:hdWitnessOptions})}catch{}}',
  "return hdWitnessOptions}",
].join("")

/** Returns a held diagnostic entry; never installs, imports, or executes it. */
export function createHighDensityWitnessPatchedEntry(source: string): {
  source: string
  anchors: HighDensityWitnessAnchor[]
  originalSha256: string
  patchedSha256: string
} {
  const originalSha256 = sha256(source)
  if (originalSha256 !== EXPECTED_AUTOROUTER_ENTRY_SHA256) {
    throw new Error(
      `Unexpected autorouter entry SHA256: ${originalSha256}; expected ${EXPECTED_AUTOROUTER_ENTRY_SHA256}`,
    )
  }

  const definitions = [
    {
      name: "preloaded-via-conflict" as const,
      original: originalViaPredicate,
      replacement: observedViaPredicate,
    },
    {
      name: "parent-copper-conflict" as const,
      original: originalParentConflict,
      replacement: observedParentConflict,
    },
    {
      name: "single-route-options" as const,
      original: originalSingleRouteOptions,
      replacement: observedSingleRouteOptions,
    },
  ]
  const anchors = definitions.map((anchor): HighDensityWitnessAnchor => {
    const count = source.split(anchor.original).length - 1
    if (count !== 1) {
      throw new Error(
        `Expected one ${anchor.name} anchor in published entry; found ${count}`,
      )
    }
    return { ...anchor, offset: source.indexOf(anchor.original) }
  })

  let patchedSource = source
  for (const anchor of anchors) {
    patchedSource = patchedSource.replace(anchor.original, anchor.replacement)
  }
  return {
    source: patchedSource,
    anchors,
    originalSha256,
    patchedSha256: sha256(patchedSource),
  }
}
