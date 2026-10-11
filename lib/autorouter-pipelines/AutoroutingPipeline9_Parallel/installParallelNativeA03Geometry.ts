import { hasNativeDescriptorMetadata } from "./nativeDescriptorMetadataGuard"
/** Geometry kernels derived from the pinned MIT source in high-density-a01-fork/LICENSE. */
import { HighDensitySolverA03 } from "@tscircuit/high-density-a01"
import { hasNativeOwnerNumericPolicy, hasOriginalNativeOwnerNames, matchesNativeOwnerKernelContract,
  nativeOwnerDescriptor, nativeOwnerHasOwn, nativeOwnerDefine, nativeOwnerDelete, nativeOwnerGet,
  nativeOwnerIs, nativeOwnerApply, type NativeOwnerKernelContract } from "./nativeOwnerKernelContract"
import { hasNativeGridKernelIntrinsics, type NativeGridIntrinsicQuantum } from "./nativeGridKernelIntrinsics"
import { captureNativeGridOwnerStorage, hasNativeGridOwnerStorage, type NativeGridOwnerStorage } from "./nativeGridOwnerStorage"

type GeometryOwnerView = {
  cellCenterX: Float64Array; cellCenterY: Float64Array
  cellMinX: Float64Array; cellMinY: Float64Array; cellMaxX: Float64Array; cellMaxY: Float64Array
  planeSize: number; layers: number; viaKeepoutRadius: number
  _viaOccs: number[]; viaOccupantsByCell: Map<number, readonly number[]>
  forEachCellNearCircle(x: number, y: number, radius: number, visit: (cellId: number) => void): void
  pushFlatOccupants(flatIndex: number, activeConnection: number, out: number[]): void
  fillViaOccupants(cellId: number, activeConnection: number): void
  computeH(z: number, cellId: number, toZ: number, toCellId: number): number
  hyperParameters: HighDensitySolverA03["hyperParameters"]
}
type PlanarTable = { distances: Float64Array; valid: Uint8Array }
type GeometryKernelState = {
  active: boolean; contract: NativeOwnerKernelContract; storage: NativeGridOwnerStorage;
  arrays: readonly Float64Array[]; planeSize: number; radius: number
  geometricCells: Map<number, Int32Array>; geometricBytes: number
  planarTables: Map<number, PlanarTable>; planarBytes: number
}
const nativePrototype = HighDensitySolverA03.prototype
const nativeDescriptors = Object.getOwnPropertyDescriptors(nativePrototype)
const nativeMath = Math
const mathGlobalDescriptor = nativeOwnerDescriptor(globalThis, "Math")!
const mathNames = ["hypot", "min", "max", "floor"] as const
const mathDescriptors = Object.getOwnPropertyDescriptors(nativeMath)
const NativeFloat64Array = Float64Array, NativeUint8Array = Uint8Array
const nativeInt32From = Int32Array.from.bind(Int32Array)
const arrayPrototype = Array.prototype, mapPrototype = Map.prototype
const arrayPush = nativeOwnerDescriptor(arrayPrototype, "push")!
const arrayIterator = nativeOwnerDescriptor(arrayPrototype, Symbol.iterator)!
const mapGet = nativeOwnerDescriptor(mapPrototype, "get")!, mapSet = nativeOwnerDescriptor(mapPrototype, "set")!
const ownerStates = new WeakMap<HighDensitySolverA03, GeometryKernelState>()
const geometryNames = ["cellCenterX", "cellCenterY", "cellMinX", "cellMinY", "cellMaxX", "cellMaxY"] as const
const installedMethods = { computeH: computeNativeOwnerH, fillViaOccupants: fillNativeOwnerVia }
const getOwnerState = ownerStates.get.bind(ownerStates), setOwnerState = ownerStates.set.bind(ownerStates)
const deleteOwnerState = ownerStates.delete.bind(ownerStates)
const byteLimit = 8 * 1024 * 1024, rowLimit = 8192

/** Only the worker-owned generated grid is immutable, never its occupants. */
function hasNativeGeometryState(owner: HighDensitySolverA03, state: GeometryKernelState,
  quantum?: NativeGridIntrinsicQuantum): boolean {
  if (!hasNativeGridKernelIntrinsics(quantum) || !hasNativeGridOwnerStorage(owner, state.storage)) return false
  const mathGlobal = nativeOwnerDescriptor(globalThis, "Math")
  const push = nativeOwnerDescriptor(arrayPrototype, "push"), iterator = nativeOwnerDescriptor(arrayPrototype, Symbol.iterator)
  const get = nativeOwnerDescriptor(mapPrototype, "get"), set = nativeOwnerDescriptor(mapPrototype, "set")
  if (!mathGlobal || mathGlobal.value !== mathGlobalDescriptor.value || mathGlobal.get || mathGlobal.set ||
    !push || push.value !== arrayPush.value || !iterator || iterator.value !== arrayIterator.value ||
    !get || get.value !== mapGet.value || !set || set.value !== mapSet.value ||
    !hasNativeOwnerNumericPolicy(owner) ||
    !matchesNativeOwnerKernelContract(owner, state.contract, nativePrototype, nativeDescriptors, installedMethods)) return false
  for (let index = 0; index < mathNames.length; index++) {
    const name = mathNames[index]!, descriptor = nativeOwnerDescriptor(nativeMath, name)
    if (!descriptor || descriptor.value !== mathDescriptors[name]!.value || descriptor.get || descriptor.set) return false
  }
  for (let index = 0; index < geometryNames.length; index++) {
    const descriptor = nativeOwnerDescriptor(owner, geometryNames[index]!)
    if (!descriptor || descriptor.value !== state.arrays[index] || descriptor.get || descriptor.set) return false
  }
  const plane = nativeOwnerDescriptor(owner, "planeSize")
  const radius = nativeOwnerDescriptor(owner, "viaKeepoutRadius")
  return plane !== undefined && radius !== undefined && plane.value === state.planeSize &&
    nativeOwnerIs(radius.value, state.radius) && plane.get === undefined && radius.get === undefined
}

function fillNativeOwnerVia(this: GeometryOwnerView, cellId: number, activeConnection: number): void {
  const state = getOwnerState(this as unknown as HighDensitySolverA03)
  if (!state?.active) {
    const method = nativeOwnerGet(nativePrototype, "fillViaOccupants", this) as GeometryOwnerView["fillViaOccupants"]
    nativeOwnerApply(method, this, [cellId, activeConnection])
    return
  }
  const occs = this._viaOccs
  occs.length = 0
  const cachedOccupants = this.viaOccupantsByCell.get(cellId)
  if (cachedOccupants) {
    for (const connId of cachedOccupants) occs.push(connId)
    return
  }
  let geometricCells = state.geometricCells.get(cellId)
  if (!geometricCells) {
    const cx = this.cellCenterX[cellId]!, cy = this.cellCenterY[cellId]!
    const intersectingCells: number[] = []
    this.forEachCellNearCircle(cx, cy, this.viaKeepoutRadius, (occCellId: number): void => {
      const qx = Math.max(this.cellMinX[occCellId]!, Math.min(this.cellMaxX[occCellId]!, cx))
      const qy = Math.max(this.cellMinY[occCellId]!, Math.min(this.cellMaxY[occCellId]!, cy))
      const dx = cx - qx, dy = cy - qy
      if (dx * dx + dy * dy <= this.viaKeepoutRadius * this.viaKeepoutRadius) intersectingCells.push(occCellId)
    })
    geometricCells = nativeInt32From(intersectingCells)
    if (state.geometricCells.size < rowLimit && state.geometricBytes + geometricCells.byteLength <= byteLimit) {
      state.geometricCells.set(cellId, geometricCells)
      state.geometricBytes += geometricCells.byteLength
    }
  }
  for (let index = 0; index < geometricCells.length; index++) {
    const occCellId = geometricCells[index]!
    for (let z = 0; z < this.layers; z++) this.pushFlatOccupants(z * this.planeSize + occCellId, activeConnection, occs)
  }
  this.viaOccupantsByCell.set(cellId, occs.slice())
}

function computeNativeOwnerH(this: GeometryOwnerView, z: number, cellId: number,
  toZ: number, toCellId: number): number {
  const state = getOwnerState(this as unknown as HighDensitySolverA03)
  if (!state?.active) {
    const method = nativeOwnerGet(nativePrototype, "computeH", this) as GeometryOwnerView["computeH"]
    return nativeOwnerApply(method, this, [z, cellId, toZ, toCellId])
  }
  let table = state.planarTables.get(toCellId)
  if (!table && state.planarTables.size < rowLimit) {
    const tableBytes = this.planeSize * (NativeFloat64Array.BYTES_PER_ELEMENT + NativeUint8Array.BYTES_PER_ELEMENT)
    if (state.planarBytes + tableBytes <= byteLimit) {
      table = { distances: new NativeFloat64Array(this.planeSize), valid: new NativeUint8Array(this.planeSize) }
      state.planarTables.set(toCellId, table)
      state.planarBytes += tableBytes
    }
  }
  let dist: number
  if (table && table.valid[cellId] === 1) dist = table.distances[cellId]!
  else {
    dist = Math.hypot(this.cellCenterX[cellId]! - this.cellCenterX[toCellId]!,
      this.cellCenterY[cellId]! - this.cellCenterY[toCellId]!)
    if (table) {
      table.distances[cellId] = dist
      table.valid[cellId] = 1
    }
  }
  if (z === toZ) return dist
  return dist + this.hyperParameters.viaBaseCost
}

export function installParallelNativeA03Geometry(owner: HighDensitySolverA03,
  contract: NativeOwnerKernelContract): void {
  const previous = getOwnerState(owner)
  deleteOwnerState(owner)
  if (previous) {
    for (let index = 0; index < 2; index++) {
      const name = index === 0 ? "computeH" : "fillViaOccupants"
      const descriptor = nativeOwnerDescriptor(owner, name)
      if (descriptor && nativeOwnerHasOwn(descriptor, "value") && descriptor.value === installedMethods[name]) nativeOwnerDelete(owner, name)
    }
  }
  if (!hasNativeDescriptorMetadata() || owner.failed || !hasOriginalNativeOwnerNames(contract, nativePrototype, nativeDescriptors) ||
    !matchesNativeOwnerKernelContract(owner, contract, nativePrototype, nativeDescriptors)) return
  const arrays: Float64Array[] = []
  for (let index = 0; index < geometryNames.length; index++) {
    const array = nativeOwnerDescriptor(owner, geometryNames[index]!)?.value
    if (!(array instanceof NativeFloat64Array)) return
    arrays[index] = array
  }
  const plane = nativeOwnerDescriptor(owner, "planeSize")
  const radius = nativeOwnerDescriptor(owner, "viaKeepoutRadius")
  if (!plane || !radius ||
    typeof plane.value !== "number" || typeof radius.value !== "number") return
  const state: GeometryKernelState = { active: false, contract, storage: captureNativeGridOwnerStorage(owner),
    arrays, planeSize: plane.value, radius: radius.value,
    geometricCells: new Map(), geometricBytes: 0, planarTables: new Map(), planarBytes: 0 }
  if (!hasNativeGeometryState(owner, state)) return
  nativeOwnerDefine(owner, { computeH: { value: computeNativeOwnerH, writable: true, configurable: true },
    fillViaOccupants: { value: fillNativeOwnerVia, writable: true, configurable: true } })
  setOwnerState(owner, state)
}

export function prepareParallelNativeA03Geometry(owner: HighDensitySolverA03, quantum?: NativeGridIntrinsicQuantum): void {
  const state = getOwnerState(owner)
  if (!state) return
  if (hasNativeGeometryState(owner, state, quantum)) {
    state.active = true
    return
  }
  state.active = false
  for (let index = 0; index < 2; index++) {
    const name = index === 0 ? "computeH" : "fillViaOccupants"
    const descriptor = nativeOwnerDescriptor(owner, name)
    if (descriptor && nativeOwnerHasOwn(descriptor, "value") && descriptor.value === installedMethods[name]) nativeOwnerDelete(owner, name)
  }
  deleteOwnerState(owner)
}

export function finishParallelNativeA03Geometry(owner: HighDensitySolverA03): void {
  const state = getOwnerState(owner)
  if (state) state.active = false
  // Direct calls outside an eligible step retain the original native lookup.
  // All retained memo state remains external to the solver's native object graph.
  // Occupant caches and mutable policy have never been stored in this memo.
}
