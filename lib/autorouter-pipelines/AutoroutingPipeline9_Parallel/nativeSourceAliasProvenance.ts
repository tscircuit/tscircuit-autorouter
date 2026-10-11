import { getReferenceDrcProxyInspector, type ReferenceDrcProxyInspector } from "./authoritative-drc-fork/initializeReferenceDrcRuntime"

export type NativeSourceAlias = { outputPath: readonly string[]; sourcePath: readonly string[] }
export type NativeSourceAliasProvenance = readonly NativeSourceAlias[]
type Path = { parent: Path | undefined; key: string; depth: number }
type Pending = { value: unknown; path: Path | undefined }
type Budget = { objects: number; properties: number; pathParts: number; characters: number }
type Substitution = { parent: object; key: string; descriptor: PropertyDescriptor; target: object; previous: object }
type OutputAliasRow = { outputPath: string[]; sourcePath: string[]; previous: object } & (
  | { root: true }
  | { root: false; parent: object; key: string; descriptor: PropertyDescriptor }
)

const ownKeys = Reflect.ownKeys
const getPrototype = Object.getPrototypeOf
const getDescriptor = Object.getOwnPropertyDescriptor
const defineProperty = Object.defineProperty
const apply = Reflect.apply
const hasOwn = Object.prototype.hasOwnProperty
const objectIs = Object.is
const isFinite = Number.isFinite
const isSafeInteger = Number.isSafeInteger
const toString = String
const arrayIsArray = Array.isArray
const weakMapGet = WeakMap.prototype.get
const weakMapSet = WeakMap.prototype.set
const weakMapHas = WeakMap.prototype.has
const weakSetHas = WeakSet.prototype.has
const weakSetAdd = WeakSet.prototype.add
const setHas = Set.prototype.has
const setAdd = Set.prototype.add
const objectPrototype = Object.prototype
const arrayPrototype = Array.prototype
const MAX_OBJECTS = 100_000
const MAX_PROPERTIES = 1_000_000
const MAX_PATH_PARTS = 4_000_000
const MAX_CHARACTERS = 32_000_000
const MAX_DEPTH = 1_024

function requireInspector(): ReferenceDrcProxyInspector {
  const inspector = getReferenceDrcProxyInspector()
  if (inspector === undefined) throw new Error("Native source alias provenance requires the initialized proxy inspector")
  return inspector
}

function assertPlainObject(value: object, inspector: ReferenceDrcProxyInspector, budget: Budget): void {
  if (inspector(value)) throw new Error("Native source alias provenance rejects Proxy objects")
  const prototype = getPrototype(value)
  if (prototype !== objectPrototype && prototype !== arrayPrototype && prototype !== null) {
    throw new Error("Native source alias provenance requires plain objects and arrays")
  }
  if (++budget.objects > MAX_OBJECTS) throw new Error("Native source alias provenance exceeds its object bound")
}

function ownData(object: object, key: string): PropertyDescriptor {
  const descriptor = getDescriptor(object, key)
  if (descriptor === undefined || !apply(hasOwn, descriptor, ["value"])) {
    throw new Error("Native source alias provenance requires existing own data properties")
  }
  return descriptor
}

function extendPath(parent: Path | undefined, key: string): Path {
  const depth = parent === undefined ? 1 : parent.depth + 1
  if (depth > MAX_DEPTH) throw new Error("Native source alias provenance exceeds its path depth bound")
  return { parent, key, depth }
}

function serializePath(path: Path | undefined, budget: Budget): string[] {
  const length = path === undefined ? 0 : path.depth
  budget.pathParts += length
  if (budget.pathParts > MAX_PATH_PARTS) throw new Error("Native source alias provenance exceeds its path bound")
  const result = new Array<string>(length)
  let cursor = path
  for (let index = length - 1; index >= 0; index--) {
    result[index] = cursor!.key
    budget.characters += cursor!.key.length
    if (budget.characters > MAX_CHARACTERS) throw new Error("Native source alias provenance exceeds its character bound")
    cursor = cursor!.parent
  }
  return result
}

/** Walk own data only. The source index contains the first identity path, never
 * a coordinate/equality match. Linked paths avoid quadratic deep-graph storage. */
function walkPlainGraph(root: unknown, inspector: ReferenceDrcProxyInspector, budget: Budget,
  source?: WeakMap<object, Path | undefined>, aliases?: NativeSourceAlias[]): WeakMap<object, Path | undefined> {
  const index = new WeakMap<object, Path | undefined>()
  const pending: Pending[] = [{ value: root, path: undefined }]
  while (pending.length !== 0) {
    const item = pending[pending.length - 1]!
    pending.length--
    const value = item.value
    if (value === null || value === undefined || typeof value === "string" || typeof value === "boolean") continue
    if (typeof value === "number" && isFinite(value)) continue
    if (typeof value !== "object") throw new Error("Native source alias provenance requires finite plain data")
    // Inspect before even querying weak collections, and before any reflection.
    if (inspector(value)) throw new Error("Native source alias provenance rejects Proxy objects")
    if (source !== undefined && apply(weakMapHas, source, [value])) {
      if (aliases!.length >= MAX_OBJECTS) throw new Error("Native source alias provenance exceeds its alias bound")
      aliases![aliases!.length] = { outputPath: serializePath(item.path, budget),
        sourcePath: serializePath(apply(weakMapGet, source, [value]), budget) }
      continue
    }
    if (apply(weakMapHas, index, [value])) continue
    assertPlainObject(value, inspector, budget)
    apply(weakMapSet, index, [value, item.path])
    const keys = ownKeys(value)
    budget.properties += keys.length
    if (budget.properties > MAX_PROPERTIES) throw new Error("Native source alias provenance exceeds its property bound")
    for (let cursor = keys.length - 1; cursor >= 0; cursor--) {
      const key = keys[cursor]!
      if (typeof key !== "string") throw new Error("Native source alias provenance rejects symbol properties")
      const descriptor = ownData(value, key)
      pending[pending.length] = { value: descriptor.value, path: extendPath(item.path, key) }
    }
  }
  return index
}

/** Internal native-worker transport for an already admitted plain finite graph.
 * Builtins are captured at module load; callers retain the closed native runtime
 * contract. Unsupported input throws, without invoking getters or Proxy traps. */
export function captureNativeSourceAliasProvenance(output: unknown, source: unknown): NativeSourceAliasProvenance {
  const inspector = requireInspector()
  const budget: Budget = { objects: 0, properties: 0, pathParts: 0, characters: 0 }
  const sourceIndex = walkPlainGraph(source, inspector, budget)
  const aliases: NativeSourceAlias[] = []
  walkPlainGraph(output, inspector, budget, sourceIndex, aliases)
  return aliases
}

function validatePath(value: unknown, inspector: ReferenceDrcProxyInspector, budget: Budget): string[] {
  if (typeof value !== "object" || value === null || inspector(value) || !arrayIsArray(value)) {
    throw new Error("Invalid native source alias path")
  }
  assertPlainObject(value, inspector, budget)
  const length = ownData(value, "length").value as unknown
  if (typeof length !== "number" || length < 0 || length > MAX_DEPTH || !isSafeInteger(length)) {
    throw new Error("Invalid native source alias path length")
  }
  const keys = ownKeys(value)
  if (keys.length !== length + 1) throw new Error("Invalid native source alias path properties")
  const result = new Array<string>(length)
  for (let index = 0; index < length; index++) {
    const key = ownData(value, toString(index)).value as unknown
    if (typeof key !== "string") throw new Error("Invalid native source alias path key")
    result[index] = key
    budget.characters += key.length
  }
  budget.pathParts += length
  if (budget.pathParts > MAX_PATH_PARTS || budget.characters > MAX_CHARACTERS) {
    throw new Error("Native source alias provenance exceeds its protocol bound")
  }
  return result
}

function resolvePath(root: unknown, path: readonly string[], replaced?: WeakSet<object>): object {
  let value = root
  for (let index = 0; index < path.length; index++) {
    if (typeof value !== "object" || value === null) throw new Error("Invalid native source alias path target")
    if (replaced !== undefined && apply(weakSetHas, replaced, [value])) {
      throw new Error("Conflicting ancestor native source alias substitutions")
    }
    value = ownData(value, path[index]!).value
  }
  if (typeof value !== "object" || value === null) throw new Error("Native source aliases must reference objects")
  return value
}

function prepareOutputAliases(output: unknown, provenance: unknown, inspector: ReferenceDrcProxyInspector,
  budget: Budget): OutputAliasRow[] {
  walkPlainGraph(output, inspector, budget)
  if (typeof provenance !== "object" || provenance === null || inspector(provenance) || !arrayIsArray(provenance)) {
    throw new Error("Invalid native source alias provenance")
  }
  assertPlainObject(provenance, inspector, budget)
  const length = ownData(provenance, "length").value as unknown
  if (typeof length !== "number" || !isSafeInteger(length) || length < 0 || length > MAX_OBJECTS ||
    ownKeys(provenance).length !== length + 1) throw new Error("Invalid native source alias provenance length")
  const rows: OutputAliasRow[] = []
  const cells = new WeakMap<object, Set<string>>()
  const sourcePaths = new WeakMap<object, string[]>()
  const replaced = new WeakSet<object>()
  for (let index = 0; index < length; index++) {
    const row = ownData(provenance, toString(index)).value as unknown
    if (typeof row !== "object" || row === null || inspector(row)) throw new Error("Invalid native source alias row")
    assertPlainObject(row, inspector, budget)
    const keys = ownKeys(row)
    if (keys.length !== 2 || !apply(hasOwn, row, ["outputPath"]) || !apply(hasOwn, row, ["sourcePath"])) {
      throw new Error("Invalid native source alias row properties")
    }
    const outputPath = validatePath(ownData(row, "outputPath").value, inspector, budget)
    const sourcePath = validatePath(ownData(row, "sourcePath").value, inspector, budget)
    const previous = resolvePath(output, outputPath)
    const previousPath = apply(weakMapGet, sourcePaths, [previous]) as string[] | undefined
    if (previousPath !== undefined) {
      if (previousPath.length !== sourcePath.length) throw new Error("Conflicting source identity native source alias substitutions")
      for (let part = 0; part < previousPath.length; part++) {
        if (previousPath[part] !== sourcePath[part]) throw new Error("Conflicting source identity native source alias substitutions")
      }
    }
    apply(weakMapSet, sourcePaths, [previous, sourcePath])
    apply(weakSetAdd, replaced, [previous])
    if (outputPath.length === 0) {
      if (length !== 1) throw new Error("Conflicting root native source alias substitutions")
      rows[rows.length] = { outputPath, sourcePath, previous, root: true }
      continue
    }
    const parentPath = new Array<string>(outputPath.length - 1)
    for (let part = 0; part < parentPath.length; part++) parentPath[part] = outputPath[part]!
    const parent = resolvePath(output, parentPath)
    const key = outputPath[outputPath.length - 1]!
    let keysForParent = apply(weakMapGet, cells, [parent]) as Set<string> | undefined
    if (keysForParent === undefined) {
      keysForParent = new Set<string>()
      apply(weakMapSet, cells, [parent, keysForParent])
    }
    if (apply(setHas, keysForParent, [key])) throw new Error("Duplicate native source alias substitution")
    apply(setAdd, keysForParent, [key])
    const descriptor = ownData(parent, key)
    rows[rows.length] = { outputPath, sourcePath, previous, root: false, parent, key, descriptor }
  }
  for (let index = 0; index < rows.length; index++) resolvePath(output, rows[index]!.outputPath, replaced)
  return rows
}

/** Protocol validation also runs on unused worker output. It never touches the
 * caller's possibly changed source graph: source existence is checked only at
 * actual ordered acceptance, after the owner establishes native eligibility. */
export function assertNativeSourceAliasOutput(output: unknown, provenance: unknown): void {
  const inspector = requireInspector()
  const budget: Budget = { objects: 0, properties: 0, pathParts: 0, characters: 0 }
  prepareOutputAliases(output, provenance, inspector, budget)
}

/** Validate the entire protocol before replacing a single output reference.
 * Structured clone already preserves fresh output-to-output aliases; replacing
 * only exact source identities also preserves those aliases and live metadata. */
export function rehydrateNativeSourceAliases<T>(output: T, source: unknown, provenance: unknown): T {
  const inspector = requireInspector()
  const budget: Budget = { objects: 0, properties: 0, pathParts: 0, characters: 0 }
  walkPlainGraph(source, inspector, budget)
  const rows = prepareOutputAliases(output, provenance, inspector, budget)
  const substitutions: Substitution[] = []
  let rootTarget: object | undefined
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]!
    const target = resolvePath(source, row.sourcePath)
    if (row.root) { rootTarget = target; continue }
    if (row.descriptor.configurable === false && row.descriptor.writable === false && !objectIs(row.previous, target)) {
      throw new Error("Native source alias substitution is not writable")
    }
    substitutions[substitutions.length] = { parent: row.parent, key: row.key, descriptor: row.descriptor,
      target, previous: row.previous }
  }
  for (let index = 0; index < substitutions.length; index++) {
    const row = substitutions[index]!
    defineProperty(row.parent, row.key, { value: row.target, writable: row.descriptor.writable,
      enumerable: row.descriptor.enumerable, configurable: row.descriptor.configurable })
  }
  return rootTarget === undefined ? output : rootTarget as T
}
