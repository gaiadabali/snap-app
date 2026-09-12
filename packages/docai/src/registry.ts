import type { Box, Document, Page } from './docdom.js';

/**
 * Which engines exist, what they can do, and where they are allowed to run.
 *
 * The important part of this file is not the list. It is that **residency is a
 * type, not a policy** (`docs/OCR.md` D17): a deployment profile filters the
 * registry before anything is routed, so an engine that would send a document
 * offshore is not "forbidden" in an air-gapped install — it is absent.
 *
 * That is the same reasoning as `BedrockClaudeProvider` throwing rather than
 * quietly falling back to the development provider. A pipeline that ships
 * Australian tax records to another jurisdiction because a config flag was
 * wrong is exactly the failure APP 8 exists to prevent, and the cheapest place
 * to make it unrepresentable is here.
 */

/** What an engine is asked to do. One engine may do several. */
export type Capability =
  | 'detect' // where is text on this page
  | 'recognise' // what does this crop say
  | 'layout' // regions and reading order
  | 'table' // cell structure
  | 'figure' // chart classification and series recovery
  | 'form' // key/value and checkbox
  | 'handwriting'
  | 'extract'; // the whole page, straight to structure (a VLM)

/**
 * Where an engine runs, which decides where the document goes.
 *
 * `in-process` never leaves the worker. `self-hosted` is our own GPU inside the
 * same account and region. `vpc-endpoint` is a managed service reached
 * privately. `external-api` leaves our infrastructure entirely — and is the
 * only one of the four that is ever a cross-border question.
 */
export type Residency = 'in-process' | 'self-hosted' | 'vpc-endpoint' | 'external-api';

/**
 * Licence of the WEIGHTS, not of our code.
 *
 * D23 sets a floor: only `apache-2.0` or `mit` weights may enter an image we
 * hand to a customer. Several of the strongest open OCR models are not
 * redistributable, and finding that out during someone's procurement review is
 * a bad day that CI can have instead.
 */
export type WeightsLicence = 'apache-2.0' | 'mit' | 'other' | 'proprietary' | 'none';

export type EngineSpec = {
  id: string;
  capabilities: Capability[];
  residency: Residency;
  requiresNetwork: boolean;
  weightsLicence: WeightsLicence;
  redistributable: boolean;
  /**
   * Escalation order within a capability. 0 is free and exact (an embedded PDF
   * text layer); higher is slower, cleverer and more expensive.
   */
  tier: 0 | 1 | 2 | 3;
  /** Measured median seconds per page. `null` until someone measures it. */
  medianSeconds: number | null;
  /** Why it is in the list, in one line. */
  note: string;
};

/** Where this deployment is allowed to send a document. */
export type Profile = 'cloud-au' | 'customer-vpc' | 'air-gapped';

/**
 * The engines a profile permits.
 *
 * Air-gapped is the strict case and drives the design: no network at all, so
 * only engines that need none. `customer-vpc` allows an external API only when
 * the customer has supplied their own credential — expressed here as excluding
 * it by default, because the safe direction for a default is inward.
 */
export function permitted(engines: EngineSpec[], profile: Profile): EngineSpec[] {
  switch (profile) {
    case 'air-gapped':
      return engines.filter((e) => !e.requiresNetwork && e.residency !== 'external-api');
    case 'customer-vpc':
      return engines.filter((e) => e.residency !== 'external-api');
    case 'cloud-au':
      return engines;
  }
}

/** Engines that can do a job, in the order they should be tried. */
export function chain(
  engines: EngineSpec[],
  capability: Capability,
  profile: Profile,
): EngineSpec[] {
  return permitted(engines, profile)
    .filter((e) => e.capabilities.includes(capability))
    .sort((a, b) => a.tier - b.tier || (a.medianSeconds ?? 99) - (b.medianSeconds ?? 99));
}

export class NoEngineAvailableError extends Error {
  constructor(capability: Capability, profile: Profile) {
    super(
      `No engine for '${capability}' is permitted under the '${profile}' profile. ` +
        'This is a deployment question, not a bug: an air-gapped install has no external engines by design.',
    );
    this.name = 'NoEngineAvailableError';
  }
}

/** A build that ships to a customer may only contain weights we may redistribute. */
export function violatesLicenceFloor(engines: EngineSpec[]): EngineSpec[] {
  return engines.filter(
    (e) =>
      e.weightsLicence !== 'none' &&
      (!e.redistributable || !['apache-2.0', 'mit'].includes(e.weightsLicence)),
  );
}

/* ── What an engine actually implements ──────────────────────────────────── */

/** One page's pixels, plus what is already known about it. */
export type PageInput = {
  page: Page;
  bytes: Uint8Array;
  mimeType: string;
  /** Read only this region. Absent means the whole page. */
  region?: Box;
};

/**
 * The reading interface.
 *
 * Returns a partial document: a detector fills `blocks` with boxes and no text,
 * a recogniser fills in spans, a layout engine sets `kind` and `order`. The
 * pipeline merges them. Nothing here returns a *field* — that is the semantic
 * layer's job, and keeping the two apart is what lets a validator outlive an
 * engine.
 */
export interface Engine {
  readonly spec: EngineSpec;
  read(input: PageInput): Promise<Partial<Document>>;
}
