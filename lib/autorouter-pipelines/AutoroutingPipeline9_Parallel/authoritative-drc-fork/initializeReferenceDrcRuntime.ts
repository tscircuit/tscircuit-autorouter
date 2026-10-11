export type ReferenceDrcProxyInspector = (value: unknown) => boolean

const descriptor = Object.getOwnPropertyDescriptor
const functionSource = Function.prototype.toString
let proxyInspector: ReferenceDrcProxyInspector | undefined
let initialization: Promise<void> | undefined

/** A missing Node capability leaves the unmodified browser checker active. */
export async function initializeReferenceDrcRuntime(): Promise<void> {
  initialization ??= (async (): Promise<void> => {
    let runtime: typeof import("node:util")
    try {
      // Keep the import computed: browser packages need not resolve node:util.
      const moduleName = ["node", "util"].join(":")
      runtime = await import(moduleName) as typeof import("node:util")
    } catch {
      return
    }
    const types = descriptor(runtime, "types")?.value as unknown
    if (typeof types !== "object" || types === null) return
    const inspector = descriptor(types, "isProxy")?.value as unknown
    if (typeof inspector !== "function" || !functionSource.call(inspector).includes("[native code]")) return
    proxyInspector = inspector as ReferenceDrcProxyInspector
  })()
  await initialization
}

export function getReferenceDrcProxyInspector(): ReferenceDrcProxyInspector | undefined {
  return proxyInspector
}
