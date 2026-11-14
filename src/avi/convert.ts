// Runs the AVI → MP4 worker (worker.ts) for the editor and reports progress.

import type { AviErrorCode } from './plan'
import type { AviMessage } from './worker'

export type AviResult = Extract<AviMessage, { type: 'done' }>

export class AviConversionError extends Error {
  constructor(
    readonly code: AviErrorCode,
    readonly codec?: string,
    detail?: string
  ) {
    super(detail ?? code)
  }
}

export type AviConversion = { promise: Promise<AviResult>; cancel(): void }

/** Converts AVI bytes to MP4 in a worker. `cancel` stops the worker and rejects nothing further. */
export function convertAvi(bytes: ArrayBuffer | Uint8Array, onProgress: (fraction: number) => void): AviConversion {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  let settled = false
  const promise = new Promise<AviResult>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<AviMessage>) => {
      const message = event.data
      if (message.type === 'progress') {
        onProgress(message.value)
        return
      }
      settled = true
      worker.terminate()
      if (message.type === 'done') {
        resolve(message)
      } else {
        reject(new AviConversionError(message.code, message.codec, message.message))
      }
    }
    worker.onerror = (event) => {
      if (settled) return
      settled = true
      worker.terminate()
      reject(new AviConversionError('failed', undefined, event.message))
    }
  })
  // A copy, so the transfer never empties the document Orca handed to the editor.
  const copy = (bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes.slice(0))).buffer
  worker.postMessage({ bytes: copy }, [copy])
  return {
    promise,
    cancel() {
      if (!settled) {
        settled = true
        worker.terminate()
      }
    }
  }
}
