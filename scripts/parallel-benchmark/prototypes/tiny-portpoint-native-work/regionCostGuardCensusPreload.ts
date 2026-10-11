import {plugin} from 'bun'
import {readFileSync, appendFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
const sourceCopies: Array<{path:string;originalSha256:string;copySha256:string}>=[]
function recordCopy(path:string,original:string,copy:string):void {
 const row={path,originalSha256:createHash('sha256').update(original).digest('hex'),copySha256:createHash('sha256').update(copy).digest('hex')}
 sourceCopies.push(row)
 if(process.env.PATHING_CENSUS_TRANSFORMS)appendFileSync(process.env.PATHING_CENSUS_TRANSFORMS,JSON.stringify(row)+'\n')
}
export function getIsolatedSourceCopies():typeof sourceCopies {return sourceCopies.map((row):typeof row=>({...row}))}
function one(source:string,needle:string,value:string):string{
 if(source.split(needle).length!==2)throw new Error('missing census seam '+needle)
 return source.replace(needle,value)
}
plugin({name:'isolated-tiny-region-cost-guard-census',setup(build){
 build.onLoad({filter:/TinyRegionCostMemo\.ts$/},args=>{
  const original=readFileSync(args.path,'utf8');let source=original
  source=one(source,'    const solver = this.solver',`    const c = getGuardCounter(this)
    c.calls++
    const solver = this.solver`)
  source=source.replaceAll('Object.is(', '(c.objectIs++, Object.is(')
  // Each replaced call needs a matching comma-expression closing parenthesis.
  for(const literal of ['this.padDiameter, padDiameter','this.densityFactor, densityFactor','this.areas[regionId], area','this.layerMasks[regionId], mask','this.rows[row], same','this.rows[row + 1], cross','this.rows[row + 2], changes','this.rows[row + 3], count']){
   source=one(source, '(c.objectIs++, Object.is('+literal+')','(c.objectIs++, Object.is('+literal+'))')
  }
  source=one(source,'      if (this.collectDiagnostics) this.diagnostics.hits++','      c.hits++; c.rank[rank]++\n      if (this.collectDiagnostics) this.diagnostics.hits++')
  source=one(source,'    if (this.collectDiagnostics) this.diagnostics.misses++','    c.misses++\n    if (this.collectDiagnostics) this.diagnostics.misses++')
  source=one(source,'    const area = width * height','    c.geometryReads += 3; c.policyReads += 2\n    const area = width * height')
  source += `
const guardCounters = new Map<object, any>()
function getGuardCounter(memo:object):any {
 let c=guardCounters.get(memo)
 if(!c){c={calls:0,hits:0,misses:0,rank:[0,0,0,0],objectIs:0,geometryReads:0,policyReads:0};guardCounters.set(memo,c)}
 return c
}
export function getIsolatedRegionCostGuardCensus():any[] {return [...guardCounters.values()].map(c=>({...c,rank:[...c.rank]}))}
`
  recordCopy(args.path,original,source)
  return {contents:source,loader:'ts'}
 })
}})
