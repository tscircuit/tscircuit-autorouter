import { createInterface } from "node:readline"
import path from "node:path"
import { spawn } from "node:child_process"
import { getPipeline9RouteCopperGeometry } from "../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { HighDensityRoute } from "../lib/types/high-density-types"
import type { CircuitJsonMetadata } from "../lib/types/srj-types"
import { mapLayerNameToZ } from "../lib/utils/mapLayerNameToZ"

type RecordValue = Record<string, any>
type ParentFields = {
  traceIndex: number
  traceId: string
  connection_name: string
  rootAliases: string[]
  markerIndex: number
  fromZ: number
  toZ: number
  markerStart: { x: number; y: number; z: number }
  markerEnd: { x: number; y: number; z: number }
  circuitJsonMetadata: CircuitJsonMetadata | null
}

const argumentsList = Bun.argv.slice(2)
const argument = (flag: string): string | undefined => {
  const index = argumentsList.indexOf(flag)
  if (index < 0) return undefined
  const value = argumentsList[index + 1]
  if (!value || value.startsWith("--")) throw new Error("Missing value for " + flag)
  return value
}
const routesPath = argument("--routes")
const outputPath = argument("--output")
if (!routesPath || !outputPath) {
  throw new Error("Usage: bun tmp/collect-through-obstacle-projections.ts --routes PATH --output PATH [--layer-count 8]")
}
const layerCountOverride = argument("--layer-count")
const checkerPath = path.resolve(import.meta.dir, "check-sample24-final-vias-raw.py")

// Read one route at a time. Importing only JsonStream does not run the checker.
const extractionScript = [
  "import hashlib, importlib.util, json, sys",
  "spec=importlib.util.spec_from_file_location('raw_geometry_stream',sys.argv[2])",
  "module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)",
  "source=sys.argv[1]",
  "hasher=hashlib.sha256()",
  "with open(source,'rb') as handle:",
  " while True:",
  "  chunk=handle.read(65536)",
  "  if not chunk: break",
  "  hasher.update(chunk)",
  "stream=module.JsonStream(source);stream.whitespace();root=stream.peek();stream.file.close()",
  "metadata={}",
  "if root=='{':",
  " for key,value in module.JsonStream(source).records(set()): metadata[key]=value",
  "print(json.dumps({'type':'header','metadata':metadata,'sourceSha256':hasher.hexdigest(),'inputRootType':root}),flush=True)",
  "if root=='[':",
  " stream=module.JsonStream(source)",
  " records=(('routes',item) for item in stream.array())",
  "elif root=='{': records=module.JsonStream(source).records({'traces','routes'})",
  "else: raise ValueError('Expected SRJ object, HD report object, or root HD route array')",
  "trace_index=-1",
  "for key,route in records:",
  " if key not in ['traces','routes']: continue",
  " trace_index+=1",
  " if not isinstance(route,dict): raise ValueError('Route must be an object')",
  " points=route.get('route',[])",
  " for marker_index,point in enumerate(points):",
  "  final=point.get('route_type')=='through_obstacle'",
  "  hd=point.get('toNextSegmentType')=='through_obstacle'",
  "  if not final and not hd: continue",
  "  if hd and marker_index+1>=len(points): raise ValueError('HD marker has no following point')",
  "  aliases=[]",
  "  for field in ['connection_name','connectionName','rootConnectionName','netConnectionName','__netConnectionName']:",
  "   value=route.get(field)",
  "   if isinstance(value,str): aliases.append(value)",
  "  aliases.extend(value for field in ['__rootConnectionNames','connectsTo'] for value in route.get(field,[]) if isinstance(value,str))",
  "  print(json.dumps({'type':'marker','traceIndex':trace_index,'traceId':route.get('pcb_trace_id',route.get('connectionName',str(trace_index))),'connection_name':route.get('connection_name',route.get('connectionName','')),'rootAliases':list(dict.fromkeys(aliases)),'markerIndex':marker_index,'kind':'srj' if final else 'hd','start':point,'end':points[marker_index+1] if hd else None,'traceThickness':route.get('traceThickness'),'viaDiameter':route.get('viaDiameter'),'vias':route.get('vias',[])}),flush=True)",
].join("\n")
const extractor = spawn("python", ["-u", "-c", extractionScript, path.resolve(routesPath), checkerPath], {
  stdio: ["ignore", "pipe", "inherit"],
})
const rows = createInterface({ input: extractor.stdout!, crlfDelay: Infinity })
const completion = new Promise<number>((resolve, reject) => {
  extractor.on("error", reject)
  extractor.on("close", (code) => resolve(code ?? 1))
})
let header: RecordValue | undefined
let layerCount = 0
let blind = false
const markers: RecordValue[] = []
const projectedWires: RecordValue[] = []
const projectedVias: RecordValue[] = []
for await (const row of rows) {
  const record = JSON.parse(row) as RecordValue
  if (record.type === "header") {
    header = record
    layerCount = Number(layerCountOverride ?? record.metadata.layerCount ?? 8)
    if (!Number.isSafeInteger(layerCount) || layerCount < 1) throw new Error("Invalid physical layer count")
    blind = record.metadata.allowBlindAndBuriedVias === true
    continue
  }
  if (!header) throw new Error("Projection extraction did not emit its source header")
  const originalStart = record.start
  let route: HighDensityRoute
  let metadata: CircuitJsonMetadata | undefined
  if (record.kind === "srj") {
    const marker = originalStart
    if (!Number.isFinite(marker.width) || marker.width <= 0) throw new Error("Final marker has invalid width")
    metadata = marker.circuitJsonMetadata
    route = {
      connectionName: record.connection_name,
      traceThickness: marker.width,
      viaDiameter: 0.3,
      route: [
        { ...marker.start, z: mapLayerNameToZ(marker.from_layer, layerCount), traceThickness: marker.width,
          toNextSegmentType: "through_obstacle", toNextSegmentCircuitJsonMetadata: metadata },
        { ...marker.end, z: mapLayerNameToZ(marker.to_layer, layerCount), traceThickness: marker.width },
      ],
      vias: [],
    }
  } else {
    metadata = originalStart.toNextSegmentCircuitJsonMetadata
    route = {
      connectionName: record.connection_name,
      traceThickness: record.traceThickness,
      viaDiameter: record.viaDiameter,
      route: [originalStart, record.end],
      vias: record.vias,
    }
  }
  for (const point of route.route) {
    if (![point.x, point.y, point.z].every(Number.isFinite) || !Number.isInteger(point.z) || point.z < 0 || point.z >= layerCount) {
      throw new Error("Through-obstacle marker has invalid physical coordinates or layer")
    }
  }
  if (!Number.isFinite(route.traceThickness) || route.traceThickness <= 0 || !Number.isFinite(route.viaDiameter) || route.viaDiameter <= 0) {
    throw new Error("Through-obstacle route has invalid physical width or via diameter")
  }
  const geometry = getPipeline9RouteCopperGeometry(route, { layerCount, allowBlindAndBuriedVias: blind })
  if (geometry.wireSegments.some((wire) => !Number.isFinite(wire.width) || wire.width <= 0)) {
    throw new Error("Actual through-obstacle projection emitted invalid wire width")
  }
  const parent: ParentFields = {
    traceIndex: record.traceIndex,
    traceId: record.traceId,
    connection_name: record.connection_name,
    rootAliases: record.rootAliases,
    markerIndex: record.markerIndex,
    fromZ: route.route[0]!.z,
    toZ: route.route[1]!.z,
    markerStart: { x: route.route[0]!.x, y: route.route[0]!.y, z: route.route[0]!.z },
    markerEnd: { x: route.route[1]!.x, y: route.route[1]!.y, z: route.route[1]!.z },
    circuitJsonMetadata: metadata ?? null,
  }
  markers.push({ ...parent, wireCount: geometry.wireSegments.length, viaCount: geometry.viaSpans.length })
  for (const wire of geometry.wireSegments) {
    projectedWires.push({ ...parent, start: { x: wire.start.x, y: wire.start.y, z: wire.start.z },
      end: { x: wire.end.x, y: wire.end.y, z: wire.end.z }, z: wire.z, width: wire.width })
  }
  for (const via of geometry.viaSpans) projectedVias.push({ ...parent, ...via })
}
const exitCode = await completion
if (exitCode !== 0 || !header) throw new Error("Route extraction failed, refusing partial projection output")
const report = {
  version: 1,
  scope: "THROUGH_OBSTACLE_PROJECTIONS_ONLY_NOT_WHOLE_BOARD_DRC",
  inputPath: path.resolve(routesPath),
  routesSha256: header.sourceSha256,
  inputRootType: header.inputRootType,
  layerCount,
  layerCountSource: layerCountOverride ? "explicit-cli" : header.metadata.layerCount ? "source-srj" : "sample24-default-eight-layer-stack",
  allowBlindAndBuriedVias: blind,
  markerCount: markers.length,
  markers,
  projectedWires,
  projectedVias,
  peakRssBytes: process.resourceUsage().maxRSS * 1024,
  extraction: "streamed Python JsonStream; projection from actual getPipeline9RouteCopperGeometry",
}
await Bun.write(outputPath, JSON.stringify(report, null, 2) + "\n")
console.log(JSON.stringify({ ...report, markers: undefined, projectedWires: undefined, projectedVias: undefined,
  projectedWireCount: projectedWires.length, projectedViaCount: projectedVias.length }))
