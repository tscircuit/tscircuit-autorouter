import { InMemoryCache } from "./InMemoryCache"
import { LocalStorageCache } from "./LocalStorageCache"

// Add global declare for globalThis to fix types
declare global {
  var TSCIRCUIT_AUTOROUTER_LOCAL_STORAGE_CACHE: LocalStorageCache
  var TSCIRCUIT_AUTOROUTER_IN_MEMORY_CACHE: InMemoryCache
}

export function getGlobalLocalStorageCache() {
  if (!globalThis.TSCIRCUIT_AUTOROUTER_LOCAL_STORAGE_CACHE) {
    setupGlobalCaches()
  }
  return globalThis.TSCIRCUIT_AUTOROUTER_LOCAL_STORAGE_CACHE
}

export function getGlobalInMemoryCache() {
  if (!globalThis.TSCIRCUIT_AUTOROUTER_IN_MEMORY_CACHE) {
    setupGlobalCaches()
  }
  return globalThis.TSCIRCUIT_AUTOROUTER_IN_MEMORY_CACHE
}

export function setupGlobalCaches() {
  globalThis.TSCIRCUIT_AUTOROUTER_LOCAL_STORAGE_CACHE ??=
    new LocalStorageCache()
  globalThis.TSCIRCUIT_AUTOROUTER_IN_MEMORY_CACHE ??= new InMemoryCache()
}
