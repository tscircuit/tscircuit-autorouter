import { expect, test } from "bun:test"
import { Arc, Box, Circle, Point, Polygon, Segment } from "@flatten-js/core"
import { circlePolygon, getPourPolygon, getTraceSegmentPolygon } from "@tscircuit/circuit-json-util"
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { gunzipSync } from "node:zlib"
import { initializeReferenceDrcRuntime } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime"
import { assertReferenceDrcPolygonSnapshot, captureReferenceDrcPolygonSnapshot, createReferenceDrcPolygonFactEvaluator, reconstructReferenceDrcPolygon } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/referenceDrcPolygonFacts"
import { createCopperPolygonContactTester } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/native/lib/copper-pour-connectivity/create-copper-polygon-contact-tester"
import { checkViaTraceClearanceWithLazyCenters } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/checkViaTraceClearanceWithLazyCenters"
import { getDrcErrors } from "../../lib/testing/getDrcErrors"

test("already-scaled polygon facts retain native faces, geometry, query state and all17 saved DRC evaluations", async () => {
  await initializeReferenceDrcRuntime()
  const repo = resolve(import.meta.dir, "../.."), work = mkdtempSync(join(tmpdir(), "reference-polygon-facts-"))
  symlinkSync(join(repo, "node_modules"), join(work, "node_modules"))
  const base = join(repo, "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork")
  const sources = { checker: join(base, "native/lib/check-traces-are-contiguous/check-traces-are-contiguous.ts"), index: join(base, "native/lib/util/create-indexed-pcb-connectivity-map.ts"), via: join(base, "native/lib/util/get-via-and-pour-connections.ts") }
  const copies = { checker: join(work, "checker.ts"), index: join(work, "index.ts"), via: join(work, "via.ts") }
  const counterPath = join(work, "counter.ts")
  const factsPath = join(base, "referenceDrcPolygonFacts.ts")
  // Reflect only owned Native data, including all cyclic polygon/face/edge/index
  // objects and native Set entries. Getter functions are recorded, never called.
  writeFileSync(counterPath, `import {deepStrictEqual} from "node:assert";
import {captureReferenceDrcPolygonSnapshot,createReferenceDrcPolygonFactEvaluator} from ${JSON.stringify(factsPath)};
export let census:any={};export function reset():void{census={privateGuard:false,misses:0,queries:0,polygons:0,edges:0,stateChecks:0}};
function state(values:any[]):any{const objects:any[]=[];const ids=new Map<object,number>();const ref=(value:any):any=>{if(value===null||(typeof value!=="object"&&typeof value!=="function"))return value;if(typeof value==="function")return value;let id=ids.get(value);if(id===undefined){id=objects.length;ids.set(value,id);objects.push(value)}return {ref:id}};const root=values.map(ref);const rows:any[]=[];for(let i=0;i<objects.length;i++){if(objects.length>100000)throw new Error("owned polygon state unexpectedly large");const object=objects[i];const properties=Reflect.ownKeys(object).map(key=>{const descriptor=Object.getOwnPropertyDescriptor(object,key)!;return[key,descriptor.enumerable,descriptor.configurable,"value"in descriptor?["data",descriptor.writable,ref(descriptor.value)]:["accessor",descriptor.get,descriptor.set]]});const entries=object instanceof Set?[...Set.prototype.values.call(object)].map(ref):object instanceof Map?[...Map.prototype.entries.call(object)].map(([key,value])=>[ref(key),ref(value)]):undefined;rows.push({properties,entries})}return{root,rows}};
export function prepare(conductors:any[],tolerance:number):any{const polygons=conductors.map(c=>c.polygon);const snapshots:any[]=[];for(const polygon of polygons){const before=state([polygon]);snapshots.push(captureReferenceDrcPolygonSnapshot(polygon));deepStrictEqual(state([polygon]),before);census.stateChecks++}const evaluator=createReferenceDrcPolygonFactEvaluator(snapshots,tolerance);census.polygons+=polygons.length;for(const snapshot of snapshots)for(const face of snapshot.faces)census.edges+=face.length;return{evaluator,polygons}}
export function verify(prepared:any,left:number,right:number,value:boolean):void{const before=state([prepared.polygons[left],prepared.polygons[right]]);deepStrictEqual(prepared.evaluator(left,right),value);deepStrictEqual(state([prepared.polygons[left],prepared.polygons[right]]),before);census.misses++;census.stateChecks++}
export function nativeState(polygons:any[]):any{return state(polygons)}
export function verifyNativeState(polygons:any[],before:any):void{deepStrictEqual(state(polygons),before);census.nativeStateChecks=(census.nativeStateChecks??0)+1}
`)
  for (const kind of Object.keys(sources) as (keyof typeof sources)[]) {
    let source = readFileSync(sources[kind], "utf8")
    if (kind === "checker") source = `import {census} from ${JSON.stringify(counterPath)}\n` + source.replace("  let scaledPolygonMemo: ScaledConductorPolygonMemo | undefined", "  census.privateGuard = useExpectedPortMemo\n  let scaledPolygonMemo: ScaledConductorPolygonMemo | undefined")
    if (kind === "via") {
      expect(source.includes("  index.finish()\n")).toBe(true)
      expect(source.includes("(): boolean => touches(a.polygon, b.polygon)")).toBe(true)
      source = `import {census,prepare,verify,nativeState,verifyNativeState} from ${JSON.stringify(counterPath)}\n` + source.replace("  index.finish()\n", "  index.finish()\n  const prepared = prepare(conductors,tolerance)\n")
        .replace('      if (primitiveMemo\n        ? primitiveMemo.getOrCompute("polygon-contact"', '      census.queries++\n      if (primitiveMemo\n        ? primitiveMemo.getOrCompute("polygon-contact"')
        .replace("(): boolean => touches(a.polygon, b.polygon)", "(): boolean => { const before = nativeState([a.polygon,b.polygon]); const value = touches(a.polygon,b.polygon); verifyNativeState([a.polygon,b.polygon],before); verify(prepared,i,j,value); return value }")
    }
    source = source.replace(/from\s+"(\.[^"]+)"/g, (_match, spec: string): string => {
      let target = resolve(dirname(sources[kind]), spec)
      if (spec.endsWith("create-indexed-pcb-connectivity-map")) target = copies.index
      else if (spec.endsWith("get-via-and-pour-connections")) target = copies.via
      return `from ${JSON.stringify(target)}`
    })
    writeFileSync(copies[kind], source)
  }
  const checker = (await import(copies.checker)).createPrivatelyMemoizedTraceContinuityChecker()
  const counter = await import(counterPath)
  const fixture = JSON.parse(gunzipSync(new Uint8Array(readFileSync(new URL("../fixtures/reference-drc-srj18/sample015-native-reference.json.gz", import.meta.url)))).toString()) as { records: any[] }
  let misses = 0, queries = 0, checks = 0, nativeStateChecks = 0
  const rows: Record<string, number>[] = []
  for (const capture of fixture.records) {
    counter.reset()
    const result = getDrcErrors(structuredClone(capture.circuitJson), { ...capture.options, traceContinuityChecker: checker,
      viaTraceChecker: (circuit: any, options: any): ReturnType<typeof checkViaTraceClearanceWithLazyCenters> => checkViaTraceClearanceWithLazyCenters(circuit, { ...options, enableAxisRejection: true, enableConnectivityMemo: true }) })
    expect(JSON.parse(JSON.stringify(result))).toEqual(capture.expected)
    expect(counter.census.privateGuard).toBe(true)
    misses += counter.census.misses; queries += counter.census.queries; checks += counter.census.stateChecks; nativeStateChecks += counter.census.nativeStateChecks ?? 0
    rows.push({ number: capture.number, queries: counter.census.queries, misses: counter.census.misses, polygons: counter.census.polygons, edges: counter.census.edges, snapshotAndRestoredStateChecks: counter.census.stateChecks, nativeQueryStateChecks: counter.census.nativeStateChecks ?? 0 })
  }
  expect(misses).toBe(15901); expect(queries).toBe(33959); expect(checks).toBeGreaterThan(15901); expect(nativeStateChecks).toBe(15901)

  const scale = 1e6, tolerance = 1e-7 * scale
  const hole = new Polygon(new Box(-2,-2,2,2)); hole.addFace(new Polygon(new Circle(new Point(0,0),0.8)).reverse().faces.values().next().value!.shapes)
  const multi = new Polygon(new Box(-2,-1,-1,1)); multi.addFace(new Polygon(new Box(1,-1,2,1)).faces.values().next().value!.shapes)
  const source = [new Polygon(), hole, multi, circlePolygon({x:0,y:0},0.8), circlePolygon({x:0.8+1e-7,y:0},0.1),
    getTraceSegmentPolygon({x:-1,y:-0},{x:1,y:0},0.2), new Polygon([new Arc(new Point(0,0),1,0,Math.PI,true),new Segment(new Point(1,0),new Point(-1,0))]),
    getPourPolygon({shape:"rect",center:{x:0,y:0},width:2,height:0.2,rotation:37} as any),
    new Polygon(new Box(-2,-0.1,2,0.1)), new Polygon(new Circle(new Point(0,1+1e-7),1))]
  const polygons = source.map((polygon): Polygon => polygon.scale(scale,scale))
  const snapshots = polygons.map(captureReferenceDrcPolygonSnapshot)
  for (let i = 0; i < polygons.length; i++) {
    expect(captureReferenceDrcPolygonSnapshot(reconstructReferenceDrcPolygon(snapshots[i]!))).toEqual(snapshots[i])
  }
  for (const tol of [0,tolerance,tolerance * (1-Number.EPSILON),tolerance * (1+Number.EPSILON),1]) {
    const facts = createReferenceDrcPolygonFactEvaluator(snapshots,tol), native = createCopperPolygonContactTester(tol)
    for (let i = 0; i < polygons.length; i++) for (let j = 0; j < polygons.length; j++) expect(facts(i,j)).toBe(native(polygons[i]!,polygons[j]!))
  }
  const observer = structuredClone(snapshots[1]!), sentinel = new RangeError("unread polygon observer")
  let reads = 0
  Object.defineProperty(observer.faces[0]![0]!, "kind", {get(): never {reads++;throw sentinel}})
  expect(() => assertReferenceDrcPolygonSnapshot(observer)).toThrow(); expect(reads).toBe(0)
  const proxy = new Proxy(snapshots[1]!, {ownKeys(): never {reads++;throw sentinel}})
  expect(() => assertReferenceDrcPolygonSnapshot(proxy)).toThrow(); expect(reads).toBe(0)
  const malformed = structuredClone(snapshots[1]!) as any; malformed.faces[0][0].kind="unknown"
  expect(() => assertReferenceDrcPolygonSnapshot(malformed)).toThrow("Unknown polygon fact")
  expect(() => createReferenceDrcPolygonFactEvaluator(snapshots,tolerance)(-1,0)).toThrow("pair index")
  const emptyFace = new Polygon(); emptyFace.addFace([])
  const emptySnapshot = captureReferenceDrcPolygonSnapshot(emptyFace)
  expect(captureReferenceDrcPolygonSnapshot(reconstructReferenceDrcPolygon(emptySnapshot))).toEqual(emptySnapshot)
  expect(createReferenceDrcPolygonFactEvaluator([emptySnapshot,snapshots[3]!],tolerance)(0,1)).toBe(createCopperPolygonContactTester(tolerance)(emptyFace,polygons[3]!))
  const nonfinite = structuredClone(snapshots[3]!) as any; nonfinite.faces[0][0].radius=Number.NaN
  expect(() => createReferenceDrcPolygonFactEvaluator([nonfinite],tolerance)).toThrow("requires finite plain data")
  writeFileSync(join(work,"proof-result.json"),JSON.stringify({ all17SavedErrorsExact: true, all17NativePrivateAdmission: true, queries, misses, snapshotAndRestoredStateChecks: checks, nativeQueryStateChecks: nativeStateChecks, rows },null,2)+"\n")
})
