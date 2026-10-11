const NativePromise = Promise
const nativeResolve = Promise.resolve
const nativeAll = Promise.all
const nativeAllSettled = Promise.allSettled
const nativeRace = Promise.race
const nativeThen = Promise.prototype.then
const apply = Reflect.apply
const defineProperty = Object.defineProperty
const iteratorSymbol: typeof Symbol.iterator = Symbol.iterator
const speciesSymbol = Symbol.species

// This class and its static/prototype methods never escape the private worker
// lifecycle. Late global Promise callbacks therefore remain native-only hooks.
class PathLifecyclePromise<T> extends NativePromise<T> {}
defineProperty(PathLifecyclePromise, "resolve", { value: nativeResolve })
defineProperty(PathLifecyclePromise, speciesSymbol, { value: PathLifecyclePromise })
defineProperty(PathLifecyclePromise.prototype, "then", { value: nativeThen })

function protect<T>(promise: Promise<T>): Promise<T> {
  defineProperty(promise, "constructor", { value: PathLifecyclePromise, configurable: true })
  defineProperty(promise, "then", { value: nativeThen, configurable: true })
  return promise
}

function ownIterable<T>(values: readonly T[]): Iterable<T> {
  return { [iteratorSymbol]: (): Iterator<T> => {
    let index = 0
    return { next: (): IteratorResult<T> => index < values.length
      ? { value: values[index++]!, done: false } : { value: undefined, done: true } }
  } }
}

export function pathLifecycleThen<T, R>(promise: Promise<T>, fulfilled: (value: T) => R | PromiseLike<R>,
  rejected?: (error: unknown) => R | PromiseLike<R>): Promise<R> {
  return protect(apply(nativeThen, protect(promise), [fulfilled, rejected]) as Promise<R>)
}

export function pathLifecycleResolve(): Promise<void> {
  return protect(apply(nativeResolve, PathLifecyclePromise, []) as Promise<void>)
}

export function pathLifecycleAll<T>(promises: readonly Promise<T>[]): Promise<T[]> {
  return protect(apply(nativeAll, PathLifecyclePromise, [ownIterable(promises)]) as Promise<T[]>)
}

export function pathLifecycleAllSettled(promises: readonly Promise<unknown>[]): Promise<PromiseSettledResult<unknown>[]> {
  return protect(apply(nativeAllSettled, PathLifecyclePromise, [ownIterable(promises)]) as Promise<PromiseSettledResult<unknown>[]>)
}

export function pathLifecycleRace<T>(promises: readonly Promise<T>[]): Promise<T> {
  return protect(apply(nativeRace, PathLifecyclePromise, [ownIterable(promises)]) as Promise<T>)
}

export function pathLifecycleFailure(register: (reject: (error: unknown) => void) => void): Promise<never> {
  return protect(new PathLifecyclePromise<never>((_resolve, reject): void => register(reject)))
}
