/**
 * The document engine's public surface.
 *
 * `docdom` is the contract and `registry` decides what may read; `pipeline` is
 * the only thing that should be calling engines, which is why the individual
 * engines are exported too but are not the intended entry point — a caller
 * reaching past `read()` to a specific engine has bypassed tier escalation,
 * profile filtering and disagreement recording all at once.
 */
export * from './docdom.js';
export * from './registry.js';
export * from './pipeline.js';
export * from './grounding.js';
export { PdfTextEngine, pdfTextEngineSpec } from './engines/pdf-text.js';
export { SidecarEngine, SidecarUnavailableError, assertSidecarLicenceFloor, SidecarLicenceFloorError } from './engines/sidecar.js';
