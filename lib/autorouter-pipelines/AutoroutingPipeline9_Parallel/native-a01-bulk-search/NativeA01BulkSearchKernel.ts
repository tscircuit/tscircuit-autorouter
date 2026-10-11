import type { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
import { searchKernelBytes } from "./searchKernelBytes"

type Rip = { id: number; prev: Rip | null }
type SearchNode = { z: number; row: number; col: number; g: number; f: number; parentIdx: number; ripped: Rip | null }
type Segment = { connId: number; endZ: number; endRow: number; endCol: number }
type NativeHeap = { f: number[]; seq: number[]; id: number[]; n: number }
type NativeState = {
  heap: NativeHeap; nodePool: SearchNode[]; activeConnSeg: Segment | null; activeConnId: number
  rows: number; cols: number; layers: number; planeSize: number; stamp: number
  usedCellsFlat: Int32Array; portOwnerFlat: Int32Array; usedDiagFlat: Int32Array; penalty2d: Float64Array
  visitedStamp: Uint32Array; connIdToRootNet: string[]; overlapFriendlyRootNets: Set<string>
  viaOccupantScanOffsetsDr: Int32Array; viaOccupantScanOffsetsDc: Int32Array; viaOccupantScanOffsetsLen: number
  viaOccupantsByCell: Map<number, readonly number[]>; viaOwnersByCell: Map<number, Set<number>>
  _viaOccs: number[]; _moveCost: number; _moveRipped: Rip | null
  minViaRow: number; maxViaRow: number; minViaCol: number; maxViaCol: number; crossLayerSearch: boolean
  ripCount: number[]; ripHistoryCostMultiplier: number; searchIterations: number; seqCounter: number
  penaltyCap: number; baseSearchBudgetIters: number; cellSizeMm: number; stepMultiplier: number
  hyperParameters: { viaBaseCost: number; ripCost: number; ripTracePenalty: number; ripViaPenalty: number; greedyMultiplier: number }
}
type KernelExports = { memory: WebAssembly.Memory; __heap_base: WebAssembly.Global
  configure: (...pointers: number[]) => void; run: () => number }
type NumericView = Float64Array | Int32Array | Uint32Array
export type NativeA01BulkSearchEvent = "limit" | "goal" | "budget" | "empty" | "cap" | "start" | "terminal"
export type NativeA01BulkSearchResult = { consumed: number; event: NativeA01BulkSearchEvent }
const events = ["limit", "goal", "budget", "empty", "cap"] as const
const MAX_ROWS = 262_144, MAX_BYTES = 64 * 1024 * 1024, PAGE_BYTES = 65_536
const enum Meta { Iter, SearchIter, Seq, HeapN, NodeN, RipN, Consumed, Event, MoveCost, MoveRip,
  ViaN, CacheNewN, MoveDirty, ViaDirty, HeapDirtyN, Generation, Pushes, Pops, Expansions, Skips }
let compiledModule: WebAssembly.Module | undefined

/** Isolated exact backend; no public pipeline, installer or default activation. */
export class NativeA01BulkSearchKernel {
  readonly diagnostics = { batches: 0, consumed: 0, heapPushes: 0, heapPops: 0, expansions: 0,
    visitedSkips: 0, hydratedHeapRows: 0, hydratedLiveNodeRows: 0, hydratedRipRows: 0,
    createdNodeRows: 0, createdRipRows: 0, flushedHeapRows: 0, memoryBytes: 0 }
  private readonly exports: KernelExports
  private readonly rows: number
  private readonly cols: number
  private readonly layers: number
  private readonly connectionCount: number
  private readonly capacityRows: number
  private readonly ripCapacity: number
  private readonly hf: Float64Array
  private readonly hs: Float64Array
  private readonly hi: Float64Array
  private readonly ng: Float64Array
  private readonly nf: Float64Array
  private readonly pen: Float64Array
  private readonly ripCounts: Float64Array
  private readonly meta: Float64Array
  private readonly cfg: Float64Array
  private readonly nz: Int32Array
  private readonly nr: Int32Array
  private readonly nc: Int32Array
  private readonly np: Int32Array
  private readonly nh: Int32Array
  private readonly rid: Int32Array
  private readonly rp: Int32Array
  private readonly used: Int32Array
  private readonly ports: Int32Array
  private readonly diags: Int32Array
  private readonly drs: Int32Array
  private readonly dcs: Int32Array
  private readonly friendly: Int32Array
  private readonly cacheValues: Int32Array
  private readonly cacheLength: Int32Array
  private readonly cacheNew: Int32Array
  private readonly viaScratch: Int32Array
  private readonly visited: Uint32Array
  private readonly heapFlags: Uint32Array
  private readonly heapDirty: Uint32Array
  private readonly cachePresent: Uint32Array

  constructor(owner: HighDensitySolverA01) {
    if (!owner._setupDone) throw new Error("Bulk A01 requires original native setup first")
    const host = owner as unknown as NativeState
    this.rows = host.rows; this.cols = host.cols; this.layers = host.layers
    this.connectionCount = host.connIdToRootNet.length
    const states = this.rows * this.cols * this.layers
    this.capacityRows = 1 + states * (this.layers + 7)
    this.ripCapacity = this.capacityRows * this.connectionCount
    if (!Number.isSafeInteger(this.rows) || this.rows < 1 || !Number.isSafeInteger(this.cols) || this.cols < 1 ||
      !Number.isSafeInteger(this.layers) || this.layers < 1 || !Number.isSafeInteger(states) || states < 1 || !Number.isSafeInteger(this.capacityRows) ||
      this.capacityRows > MAX_ROWS || !Number.isSafeInteger(this.ripCapacity)) {
      throw new RangeError("Bulk A01 geometry exceeds the bounded kernel domain")
    }
    const plane=this.rows*this.cols, diagonalCount=this.layers*(this.rows-1)*(this.cols-1)*2
    if (host.planeSize!==plane || host.usedDiagFlat.length!==diagonalCount ||
      !Number.isSafeInteger(host.viaOccupantScanOffsetsLen) || host.viaOccupantScanOffsetsLen<0 ||
      host.viaOccupantScanOffsetsDr.length!==host.viaOccupantScanOffsetsLen ||
      host.viaOccupantScanOffsetsDc.length!==host.viaOccupantScanOffsetsLen) {
      throw new Error("Bulk A01 native storage layout is inconsistent")
    }
    compiledModule ??= new WebAssembly.Module(searchKernelBytes)
    if (WebAssembly.Module.imports(compiledModule).length !== 0) throw new Error("Bulk A01 introduced runtime imports")
    const instance = new WebAssembly.Instance(compiledModule)
    this.exports = instance.exports as unknown as KernelExports
    const pointers: number[] = [], lengths: number[] = [], types: (typeof Float64Array | typeof Int32Array | typeof Uint32Array)[] = []
    const counts = [this.capacityRows,this.capacityRows,this.capacityRows,this.capacityRows,this.capacityRows,
      host.planeSize,this.connectionCount,32,32,
      this.capacityRows,this.capacityRows,this.capacityRows,this.capacityRows,this.capacityRows,
      this.ripCapacity,this.ripCapacity,states,states,host.usedDiagFlat.length,
      host.viaOccupantScanOffsetsLen,host.viaOccupantScanOffsetsLen,this.connectionCount,
      host.planeSize*this.connectionCount,host.planeSize,host.planeSize,this.connectionCount,
      states,this.capacityRows,this.capacityRows,host.planeSize]
    let cursor = Math.ceil(Number(this.exports.__heap_base.value) / 8) * 8
    for (let index = 0; index < counts.length; index++) {
      const type = index < 9 ? Float64Array : index < 26 ? Int32Array : Uint32Array
      pointers[index] = cursor; lengths[index] = counts[index]!; types[index] = type
      cursor += counts[index]! * type.BYTES_PER_ELEMENT
      cursor = Math.ceil(cursor / 8) * 8
    }
    if (cursor > MAX_BYTES) throw new RangeError("Bulk A01 memory exceeds64MiB bounded domain")
    const memory = this.exports.memory, pages = Math.ceil(cursor / PAGE_BYTES)
    if (pages > memory.buffer.byteLength / PAGE_BYTES) memory.grow(pages - memory.buffer.byteLength / PAGE_BYTES)
    const views: NumericView[] = []
    for (let index = 0; index < counts.length; index++) views[index] = new types[index]!(memory.buffer, pointers[index]!, lengths[index]!)
    this.hf=views[0] as Float64Array; this.hs=views[1] as Float64Array; this.hi=views[2] as Float64Array
    this.ng=views[3] as Float64Array; this.nf=views[4] as Float64Array; this.pen=views[5] as Float64Array
    this.ripCounts=views[6] as Float64Array; this.meta=views[7] as Float64Array; this.cfg=views[8] as Float64Array
    this.nz=views[9] as Int32Array; this.nr=views[10] as Int32Array; this.nc=views[11] as Int32Array
    this.np=views[12] as Int32Array; this.nh=views[13] as Int32Array; this.rid=views[14] as Int32Array
    this.rp=views[15] as Int32Array; this.used=views[16] as Int32Array; this.ports=views[17] as Int32Array
    this.diags=views[18] as Int32Array; this.drs=views[19] as Int32Array; this.dcs=views[20] as Int32Array
    this.friendly=views[21] as Int32Array; this.cacheValues=views[22] as Int32Array
    this.cacheLength=views[23] as Int32Array; this.cacheNew=views[24] as Int32Array; this.viaScratch=views[25] as Int32Array
    this.visited=views[26] as Uint32Array; this.heapFlags=views[27] as Uint32Array
    this.heapDirty=views[28] as Uint32Array; this.cachePresent=views[29] as Uint32Array
    this.exports.configure(...pointers)
    this.diagnostics.memoryBytes = cursor
  }

  /** Fresh snapshot every run; no owner contents are inferred from identity. */
  runActiveSearch(owner: HighDensitySolverA01, maxLogicalSteps: number): NativeA01BulkSearchResult {
    if (!Number.isSafeInteger(maxLogicalSteps) || maxLogicalSteps < 1 || maxLogicalSteps > 100) {
      throw new RangeError("Bulk A01 is bounded by the original100-step quantum")
    }
    if (owner.solved || owner.failed) return { consumed: 0, event: "terminal" }
    const host = owner as unknown as NativeState
    if (!host.activeConnSeg) return { consumed: 0, event: "start" }
    this.validateState(host)
    const heap = host.heap, oldNodes = host.nodePool.length, oldRipObjects: Rip[] = []
    const entryHeapRows = heap.f.length, entryLiveRows = heap.n
    const ripIndexes = new WeakMap<Rip, number>()
    const policy = host.hyperParameters, active = host.activeConnSeg
    const activeRoot = host.connIdToRootNet[host.activeConnId]!
    const permitsOverlap = host.overlapFriendlyRootNets.has(activeRoot)
    this.meta.fill(0, 0, Meta.Generation)
    this.meta.fill(0, Meta.Pushes)
    let generation = (this.meta[Meta.Generation]! + 1) >>> 0
    if (generation === 0) { this.heapFlags.fill(0); generation = 1 }
    this.meta[Meta.Generation] = generation
    this.meta[Meta.Iter] = owner.iterations; this.meta[Meta.SearchIter] = host.searchIterations
    this.meta[Meta.Seq] = host.seqCounter; this.meta[Meta.HeapN] = heap.n; this.meta[Meta.NodeN] = oldNodes
    this.cfg.set([host.rows,host.cols,host.layers,host.stamp,host.activeConnId,
      active.endZ,active.endRow,active.endCol,host.cellSizeMm,host.penaltyCap,
      policy.viaBaseCost,policy.ripCost,host.ripHistoryCostMultiplier,policy.ripTracePenalty,policy.ripViaPenalty,
      policy.greedyMultiplier,host.minViaRow,host.maxViaRow,host.minViaCol,host.maxViaCol,
      Number(host.crossLayerSearch),Math.round(host.baseSearchBudgetIters*(1+Math.min(host.ripCount[host.activeConnId]??0,10)*.25)),
      owner.MAX_ITERATIONS,maxLogicalSteps,host.viaOccupantScanOffsetsLen,this.connectionCount,Math.SQRT2])
    this.hf.set(heap.f); this.hs.set(heap.seq); this.hi.set(heap.id)
    this.used.set(host.usedCellsFlat); this.ports.set(host.portOwnerFlat); this.diags.set(host.usedDiagFlat)
    this.pen.set(host.penalty2d); this.visited.set(host.visitedStamp)
    this.drs.set(host.viaOccupantScanOffsetsDr); this.dcs.set(host.viaOccupantScanOffsetsDc)
    for (let id = 0; id < this.connectionCount; id++) {
      this.friendly[id] = Number(permitsOverlap && host.connIdToRootNet[id] === activeRoot)
      this.ripCounts[id] = host.ripCount[id] ?? 0
    }
    for (let index = 0; index < heap.n; index++) {
      const id = heap.id[index]!, row = host.nodePool[id]!
      if (!Number.isSafeInteger(id) || id < 0 || id >= oldNodes || !row) throw new Error("Bulk A01 received an invalid live node id")
      this.validateNode(row)
      this.nz[id]=row.z; this.nr[id]=row.row; this.nc[id]=row.col
      const flat = (row.z * host.rows + row.row) * host.cols + row.col
      if (host.visitedStamp[flat] !== host.stamp) {
        if (typeof row.g !== "number") throw new Error("Bulk A01 received nonnumeric native g")
        this.ng[id]=row.g
        this.nh[id]=this.importRip(row.ripped,ripIndexes,oldRipObjects)
      }
    }
    this.meta[Meta.RipN] = oldRipObjects.length
    this.cachePresent.fill(0)
    for (const [cell, occupants] of host.viaOccupantsByCell) {
      if (!Number.isSafeInteger(cell) || cell < 0 || cell >= host.planeSize || occupants.length > this.connectionCount) {
        throw new Error("Bulk A01 received an invalid native via cache")
      }
      this.cachePresent[cell]=1; this.cacheLength[cell]=occupants.length
      for (let index=0; index<occupants.length; index++) {
        const id=occupants[index]!
        if (!Number.isSafeInteger(id) || id<0 || id>=this.connectionCount) throw new Error("Bulk A01 via cache contains unknown connection")
        this.cacheValues[cell*this.connectionCount+index]=id
      }
    }
    const consumed = this.exports.run(), event = events[this.meta[Meta.Event]!]
    if (!event || consumed !== this.meta[Meta.Consumed] || consumed > maxLogicalSteps) throw new Error("Bulk A01 emitted an invalid native frontier")
    this.flushState(owner,host,oldNodes,oldRipObjects)
    this.diagnostics.batches++; this.diagnostics.consumed+=consumed
    this.diagnostics.heapPushes+=this.meta[Meta.Pushes]!; this.diagnostics.heapPops+=this.meta[Meta.Pops]!
    this.diagnostics.expansions+=this.meta[Meta.Expansions]!; this.diagnostics.visitedSkips+=this.meta[Meta.Skips]!
    this.diagnostics.hydratedHeapRows+=entryHeapRows
    this.diagnostics.hydratedLiveNodeRows+=entryLiveRows
    this.diagnostics.hydratedRipRows+=oldRipObjects.length
    this.diagnostics.createdNodeRows+=host.nodePool.length-oldNodes
    return { consumed, event }
  }

  private importRip(head: Rip | null, indexes: WeakMap<Rip, number>, objects: Rip[]): number {
    if (head === null) return -1
    const stack: Rip[] = [], seen = new WeakSet<Rip>()
    let current: Rip | null = head
    while (current !== null && !indexes.has(current)) {
      if (typeof current !== "object" || seen.has(current) || !Number.isSafeInteger(current.id) ||
        current.id < 0 || current.id >= this.connectionCount) throw new Error("Bulk A01 received an invalid native rip graph")
      seen.add(current); stack.push(current); current=current.prev
    }
    let tail = current === null ? -1 : indexes.get(current)!
    for (let index=stack.length-1; index>=0; index--) {
      const row=stack[index]!, id=objects.length
      if (id >= this.ripCapacity) throw new Error("Bulk A01 rip graph exceeds its bounded domain")
      this.rid[id]=row.id; this.rp[id]=tail; indexes.set(row,id); objects.push(row); tail=id
    }
    return tail
  }

  private flushState(owner: HighDensitySolverA01, host: NativeState, oldNodes: number, oldRips: Rip[]): void {
    const firstNewRip=oldRips.length, ripObjects=oldRips.slice()
    for (let index=firstNewRip; index<this.meta[Meta.RipN]!; index++) {
      const prev=this.rp[index]!
      ripObjects[index]={id:this.rid[index]!,prev:prev<0 ? null : ripObjects[prev]!}
    }
    for (let index=oldNodes; index<this.meta[Meta.NodeN]!; index++) host.nodePool.push({
      z:this.nz[index]!,row:this.nr[index]!,col:this.nc[index]!,g:this.ng[index]!,f:this.nf[index]!,
      parentIdx:this.np[index]!,ripped:this.nh[index]!<0 ? null : ripObjects[this.nh[index]!]!,
    })
    for (let index=0; index<this.meta[Meta.HeapDirtyN]!; index++) {
      const row=this.heapDirty[index]!
      host.heap.f[row]=this.hf[row]!; host.heap.seq[row]=this.hs[row]!; host.heap.id[row]=this.hi[row]!
    }
    host.heap.n=this.meta[Meta.HeapN]!
    host.visitedStamp.set(this.visited)
    for (let index=0; index<this.meta[Meta.CacheNewN]!; index++) {
      const cell=this.cacheNew[index]!, occupants: number[]=[]
      for (let offset=0; offset<this.cacheLength[cell]!; offset++) occupants.push(this.cacheValues[cell*this.connectionCount+offset]!)
      host.viaOccupantsByCell.set(cell,occupants)
    }
    if (this.meta[Meta.ViaDirty]) {
      host._viaOccs.length=0
      for (let index=0; index<this.meta[Meta.ViaN]!; index++) host._viaOccs.push(this.viaScratch[index]!)
    }
    if (this.meta[Meta.MoveDirty]) {
      host._moveCost=this.meta[Meta.MoveCost]!
      host._moveRipped=this.meta[Meta.MoveRip]!<0 ? null : ripObjects[this.meta[Meta.MoveRip]!]!
    }
    owner.iterations=this.meta[Meta.Iter]!
    host.searchIterations=this.meta[Meta.SearchIter]!; host.seqCounter=this.meta[Meta.Seq]!
    this.diagnostics.flushedHeapRows+=this.meta[Meta.HeapDirtyN]!
    this.diagnostics.createdRipRows+=this.meta[Meta.RipN]!-firstNewRip
  }

  private validateNode(node: SearchNode): void {
    if (!Number.isSafeInteger(node.z) || node.z<0 || node.z>=this.layers ||
      !Number.isSafeInteger(node.row) || node.row<0 || node.row>=this.rows ||
      !Number.isSafeInteger(node.col) || node.col<0 || node.col>=this.cols) {
      throw new Error("Bulk A01 live node is outside its native grid")
    }
  }

  private validateState(host: NativeState): void {
    const plane=this.rows*this.cols, states=plane*this.layers, heap=host.heap
    const diagonalCount=this.layers*(this.rows-1)*(this.cols-1)*2
    if (host.rows!==this.rows || host.cols!==this.cols || host.layers!==this.layers ||
      host.connIdToRootNet.length!==this.connectionCount || host.stepMultiplier!==1 || host.viaOwnersByCell.size!==0 ||
      host.planeSize!==plane || host.usedDiagFlat.length!==diagonalCount || host.usedDiagFlat.length!==this.diags.length ||
      host.viaOccupantScanOffsetsLen!==this.drs.length || host.viaOccupantScanOffsetsDr.length!==this.drs.length ||
      host.viaOccupantScanOffsetsDc.length!==this.dcs.length || !Number.isSafeInteger(host.stamp) ||
      host.stamp<1 || host.stamp>0xffffffff ||
      host.usedCellsFlat.length!==states || host.portOwnerFlat.length!==states || host.visitedStamp.length!==states ||
      host.penalty2d.length!==this.rows*this.cols || host.nodePool.length>this.capacityRows ||
      heap.f.length!==heap.seq.length || heap.f.length!==heap.id.length || heap.f.length>this.capacityRows ||
      !Number.isSafeInteger(heap.n) || heap.n<0 || heap.n>heap.f.length) {
      throw new Error("Bulk A01 active state is outside its bounded native domain")
    }
    if (!Number.isSafeInteger(host.activeConnId) || host.activeConnId<0 || host.activeConnId>=this.connectionCount) {
      throw new Error("Bulk A01 active connection has no native root")
    }
    this.validateNode({ z:host.activeConnSeg!.endZ, row:host.activeConnSeg!.endRow, col:host.activeConnSeg!.endCol } as SearchNode)
    for (let index=0; index<this.connectionCount; index++) if (typeof host.connIdToRootNet[index]!=="string") {
      throw new Error("Bulk A01 requires native string root-net identities")
    }
    for (let index=0; index<host.usedCellsFlat.length; index++) {
      const used=host.usedCellsFlat[index]!, port=host.portOwnerFlat[index]!
      if (used< -1 || used>=this.connectionCount || port< -2 || port>=this.connectionCount) throw new Error("Bulk A01 has an unknown occupancy owner")
    }
    for (let index=0; index<host.usedDiagFlat.length; index++) if (host.usedDiagFlat[index]!< -1 || host.usedDiagFlat[index]!>=this.connectionCount) {
      throw new Error("Bulk A01 has an unknown diagonal owner")
    }
    for (let index=0; index<heap.f.length; index++) if (typeof heap.f[index]!=="number" || typeof heap.seq[index]!=="number" || typeof heap.id[index]!=="number") {
      throw new Error("Bulk A01 requires complete numeric native heap tails")
    }
  }
}
