// Centralized pdfjs-dist setup. Everything in the app that touches PDF
// rendering goes through THIS module — never `import * from 'pdfjs-dist'`
// directly. That way the worker config can't drift between callers and
// future phases (overlay canvas, calibration, measurement tools) all
// share the same singleton worker.

import * as pdfjsLib from 'pdfjs-dist'
// Vite-native asset URL import. At build time Vite copies the worker
// file into the output and returns the hashed asset URL as a string,
// so this works in both dev and production without manual setup.
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

// pdfjsLib.GlobalWorkerOptions is a module-level singleton — set once,
// at first import of this file, for the lifetime of the page.
pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc

export const getDocument = pdfjsLib.getDocument

// Re-export the proxy/task types so callers can stay decoupled from
// the pdfjs-dist import path. If we ever swap engines (unlikely) or
// shim for SSR, the surface to update is just this file.
export type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'
