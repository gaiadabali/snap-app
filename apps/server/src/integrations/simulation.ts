/**
 * Which external integrations are real right now, which are simulated, and
 * which are simply absent — asked in one place, answered the same way for all
 * of them.
 *
 * ── Why this module exists ────────────────────────────────────────────────
 *
 * `docs/INTEGRATIONS.md` builds five external integrations (KMS, mailer,
 * Stripe, Xero, PowerSync) before their vendors are live, and simulates each
 * one until the other side approves. That is a reasonable thing to do and a
 * dangerous one to do five times by hand: five ad-hoc env-var conventions
 * means five chances for one of them to default the wrong way, and the
 * failure would be silent in exactly the way this project has already shipped
 * three times (the dev sign-in bypass whose comment said "must not ship", the
 * model exclusion that lived only in a document, the OCR stage behind an
 * unset switch).
 *
 * So the convention is code, not prose, and every lane in that document reads
 * it from here.
 *
 * ── The three states, and why "absent" is not "simulated" ─────────────────
 *
 *   real       — vendor credentials are configured. The real client runs.
 *   simulated  — no credentials, and this deployment has EXPLICITLY opted in
 *                to the simulator, which speaks the vendor's wire protocol.
 *   absent     — no credentials and no opt-in. The feature is off and says so.
 *
 * `absent` is the default and it is not a degraded `simulated`. A missing
 * integration that quietly simulates itself is the "green everywhere except
 * where it matters" failure that `credits/payment-provider.ts` refuses by
 * name. Absent means the buy button says card payments are not connected;
 * simulated means someone typed `STRIPE_SIMULATOR=true` and meant it.
 *
 * ── Real credentials always win ───────────────────────────────────────────
 *
 * The instant a vendor credential is configured, `simulationMode` returns
 * `real` no matter what the simulator flag says. That property is lifted
 * directly from `config.ts#isGoogleSignInSimulatorEnabled`, whose comment
 * gives the reason: "nobody has to remember to flip the other two flags back
 * off once it exists". The day a Xero certification lands, setting the client
 * id is the whole change — there is no second step that, if forgotten, leaves
 * production talking to a simulator.
 *
 * ── Why this reads `process.env` rather than `config()` ───────────────────
 *
 * `config.ts` is the rule ("nothing reads process.env anywhere else") and
 * this is its second documented exception, for the same reason
 * `admin/crypto/kms.ts` is the first: `config()` validates its ENTIRE schema
 * (including `DATABASE_URL`) on first call, and the KMS provider — one of the
 * five callers here — is deliberately usable from a standalone unit suite
 * with no database at all. Taking the environment as a parameter keeps this
 * module pure, keeps it callable from `kms.ts`, and makes the table-driven
 * test below possible without touching the process environment.
 */

export type IntegrationId = 'kms' | 'mailer' | 'stripe' | 'xero' | 'powersync';

export type SimulationMode = 'real' | 'simulated' | 'absent';

/** The subset of the environment this module reads. */
export type Env = Record<string, string | undefined>;

export interface IntegrationSpec {
  readonly id: IntegrationId;
  /** For operator-facing messages: "Stripe", not "stripe". */
  readonly label: string;
  /** The one variable that opts this deployment in to the simulator. */
  readonly simulatorVar: string;
  /**
   * The variables that, if any is set, mean the real vendor is configured.
   * Listed rather than probed so `docs/DEPLOY.md` and this file cannot drift.
   */
  readonly credentialVars: readonly string[];
  /** What the simulator actually speaks, for the boot warning. */
  readonly protocol: string;
}

/**
 * The five, declared once.
 *
 * The firm console is the sixth item in `docs/INTEGRATIONS.md` and is
 * deliberately NOT here: it has no external vendor, nothing about it is
 * simulated, and giving it a simulator flag would invent a gate with nothing
 * behind it.
 */
export const INTEGRATIONS: readonly IntegrationSpec[] = [
  {
    id: 'kms',
    label: 'KMS (Vault Transit)',
    simulatorVar: 'KMS_SIMULATOR',
    // ADMIN_KMS_PROVIDER alone is not a credential — `local` is its default
    // and names the in-repo stand-in. The Vault address is what says a real
    // KMS exists to talk to.
    credentialVars: ['VAULT_ADDR'],
    protocol: "Vault's Transit HTTP API",
  },
  {
    id: 'mailer',
    label: 'Mailer (SMTP)',
    simulatorVar: 'MAILER_SIMULATOR',
    credentialVars: ['SMTP_URL', 'MAILER_PROVIDER'],
    protocol: 'SMTP over a real socket',
  },
  {
    id: 'stripe',
    label: 'Stripe',
    simulatorVar: 'STRIPE_SIMULATOR',
    credentialVars: ['STRIPE_SECRET_KEY'],
    protocol: "Stripe's Checkout Sessions REST shape and Stripe-Signature HMAC",
  },
  {
    id: 'xero',
    label: 'Xero',
    simulatorVar: 'XERO_SIMULATOR',
    credentialVars: ['XERO_CLIENT_ID'],
    protocol: "Xero's OAuth2 and Accounting API, including its 429s",
  },
  {
    id: 'powersync',
    label: 'PowerSync',
    simulatorVar: 'POWERSYNC_SIMULATOR',
    credentialVars: ['POWERSYNC_URL'],
    protocol: "PowerSync's sync-rules and token endpoints",
  },
] as const;

export function specFor(id: IntegrationId): IntegrationSpec {
  const spec = INTEGRATIONS.find((s) => s.id === id);
  // Unreachable through the type, reachable through a bad cast at a boundary.
  if (!spec) throw new Error(`Unknown integration id: ${String(id)}`);
  return spec;
}

function isTrue(value: string | undefined): boolean {
  // Exactly the transform `config.ts` applies to its own boolean flags —
  // `'true'` and nothing else, so `SIMULATOR=0` or `=no` cannot read as on.
  return value === 'true';
}

function hasRealCredentials(spec: IntegrationSpec, env: Env): boolean {
  return spec.credentialVars.some((name) => {
    const value = env[name];
    return typeof value === 'string' && value.trim() !== '';
  });
}

/**
 * Whether a deployment is allowed to run ANY simulator at all.
 *
 * The same disjunct `isGoogleSignInSimulatorEnabled` uses, and for the same
 * stated reason: the demo host runs the same build as production, so
 * `NODE_ENV` alone cannot be the signal, and a plain production deployment —
 * one that never sets `DEMO_ENV` — fails this outright.
 */
export function isSimulationPermitted(env: Env = process.env): boolean {
  return env.NODE_ENV !== 'production' || env.DEMO_ENV === 'staging';
}

/**
 * The answer, for one integration.
 *
 * Note the order: real credentials are checked FIRST and short-circuit
 * everything. A deployment that has both a credential and a stale simulator
 * flag is `real`, not a conflict to resolve at 3am.
 */
export function simulationMode(id: IntegrationId, env: Env = process.env): SimulationMode {
  const spec = specFor(id);
  if (hasRealCredentials(spec, env)) return 'real';
  if (isTrue(env[spec.simulatorVar]) && isSimulationPermitted(env)) return 'simulated';
  return 'absent';
}

/** Convenience for the common question at a call site. */
export function isSimulated(id: IntegrationId, env: Env = process.env): boolean {
  return simulationMode(id, env) === 'simulated';
}

export interface SimulationFinding {
  readonly id: IntegrationId;
  readonly label: string;
  readonly message: string;
}

export interface SimulationReport {
  /** Simulators that are ACTIVE and permitted. An operator must know. */
  readonly active: SimulationFinding[];
  /**
   * Simulators a production host asked for and did NOT get, because
   * `DEMO_ENV` is unset. Fatal: the operator believes an integration works.
   */
  readonly refused: SimulationFinding[];
}

/**
 * What `preflight.ts` reports at boot.
 *
 * The `refused` list is the important half and it is FATAL there, not a
 * warning. An operator who set `STRIPE_SIMULATOR=true` on a real production
 * host believes payments are being taken; what actually happens is that
 * `simulationMode` returns `absent` and the buy button quietly says card
 * payments are not connected. Booting anyway would make that discoverable
 * only from a support ticket about missing revenue.
 */
export function evaluateSimulations(env: Env = process.env): SimulationReport {
  const permitted = isSimulationPermitted(env);
  const active: SimulationFinding[] = [];
  const refused: SimulationFinding[] = [];

  for (const spec of INTEGRATIONS) {
    if (!isTrue(env[spec.simulatorVar])) continue;
    if (hasRealCredentials(spec, env)) {
      // Not a finding. Real credentials win by design, and saying so at every
      // boot would train operators to ignore this section.
      continue;
    }
    if (permitted) {
      active.push({
        id: spec.id,
        label: spec.label,
        message:
          `${spec.label} is SIMULATED, not real. It speaks ${spec.protocol}, so the integration ` +
          `is genuinely exercised — but nothing leaves this deployment. Correct for a demo host; ` +
          `never for anything real. Set ${spec.credentialVars[0]} to go live.`,
      });
    } else {
      refused.push({
        id: spec.id,
        label: spec.label,
        message:
          `${spec.simulatorVar}=true on a production host without DEMO_ENV=staging. The simulator ` +
          `is REFUSED, so ${spec.label} is absent, not simulated — and an operator who set this ` +
          `flag believes it is working. Either configure the real vendor (${spec.credentialVars.join(
            ' or ',
          )}) or set DEMO_ENV=staging if this is genuinely the demo host.`,
      });
    }
  }

  return { active, refused };
}
