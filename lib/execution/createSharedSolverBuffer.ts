/**
 * Copy a view's visible bytes into one fixed-size shared allocation. Subarrays
 * retain their byte range; later mutations of the source do not affect the copy.
 * Publish the result before submitting tasks and keep shared inputs immutable
 * until every consuming task has settled. Each task owns its mutable workspace.
 */
export function createSharedSolverBuffer(
  source: ArrayBufferView,
): SharedArrayBuffer {
  const buffer = new SharedArrayBuffer(source.byteLength)
  const sourceBytes = new Uint8Array(
    source.buffer,
    source.byteOffset,
    source.byteLength,
  )
  new Uint8Array(buffer).set(sourceBytes)
  return buffer
}
