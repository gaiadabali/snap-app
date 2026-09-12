import {
  authToken,
  awaitWorkspace,
  setActiveWorkspaceId,
  setAuthToken,
} from './context';
import {
  clearOutbox,
  enqueue,
  flush,
  loadOutbox,
  pendingCount,
  type OutboxEntry,
  type SendOutcome,
} from './outbox';
import type {
  AnalyticsRange,
  AnalyticsSummary,
  AuthUser,
  Bill,
  BusinessSettings,
  CategorySetting,
  Connection,
  CreateCaptureRequest,
  CreateCaptureResponse,
  DocumentFilter,
  DocumentLine,
  DocumentView,
  Goal,
  Invoice,
  Item,
  MemberList,
  MemberRole,
  MileageSummary,
  OnboardingInput,
  Overview,
  Party,
  Payment,
  PaymentMethod,
  Permissions,
  PersonalSummary,
  PlanUsage,
  Recurring,
  SalesSummary,
  Session,
  SnapApi,
  StockMovement,
  TaxPack,
  TaxPackFile,
  Trip,
  UpdateDocumentRequest,
  Workspace,
  WorkspaceSummary,
} from './types';

/**
 * The real backend.
 *
 * Every screen already talks to `SnapApi` and nothing else, so this class is
 * the whole of "connect the app to the server" — no screen changes, which is
 * what the seam was for.
 *
 * Three things it does that a naive fetch wrapper would not:
 *
 *  1. It carries the ACTIVE WORKSPACE. Almost every seam method is implicitly
 *     scoped to one, while the server wants it in a header, so the id lives in
 *     `context.ts` and is attached here. Methods that take a workspace KIND
 *     (`'business' | 'personal'`) resolve it to an id, because a kind is not
 *     an address — a person can own two businesses.
 *
 *  2. It turns errors into sentences. A screen showing "Request failed with
 *     status code 409" has told the user nothing; the server already sends a
 *     message written for them, and this surfaces that.
 *
 *  3. It returns what the seam promises, not what the endpoint returns. The
 *     endpoints are REST-shaped and several seam methods are "do this, then
 *     give me the updated list", which is a deliberate client convenience.
 */

/** Thrown for any non-2xx. Carries the server's own wording where there is one. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, message: string, code: string | null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

type Json = Record<string, unknown>;

/**
 * The methods whose failure is worth queueing.
 *
 * A GET is absent because there is nothing to replay — only data we do not
 * have. The capture flow is excluded separately (see `createCapture`): it is
 * a three-step exchange over binary bytes, and half of one in a JSON queue is
 * not a capture, it is a broken record.
 */
const QUEUEABLE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** A key for one write, minted once and reused by every retry of it. */
function newKey(): string {
  return `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export class HttpApi implements SnapApi {
  /**
   * The workspace list, cached only to resolve a KIND to an id.
   *
   * Not a general cache: it is refreshed whenever the server hands back a list
   * and is never used to answer a screen. Caching answers is how a UI shows a
   * figure that was true a minute ago.
   */
  private workspaces: WorkspaceSummary[] = [];

  constructor(private readonly baseUrl: string) {}

  /* ── Transport ────────────────────────────────────────────────────────── */

  private async request<T>(
    method: string,
    path: string,
    options: {
      body?: unknown;
      workspaceId?: string | null;
      auth?: boolean;
      /** Sent as `Idempotency-Key`, so a retry of this write happens once. */
      idempotencyKey?: string;
      /** false for a write that must NOT be queued offline — see `queue`. */
      queue?: boolean;
    } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (options.auth !== false) {
      const token = authToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    // `workspaceId: null` is an explicit "this call is not workspace-scoped"
    // (signing in, listing workspaces) and must not wait for one. Anything
    // else waits, because on a cold start the screens mount before the
    // workspace provider has finished loading.
    const workspace =
      options.workspaceId === null
        ? null
        : (options.workspaceId ?? (await awaitWorkspace()));
    if (workspace) headers['X-Workspace-Id'] = workspace;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';

    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch {
      // A network failure is not a server error and must not read like one:
      // this app is used at truck stops, where no signal is the normal case.
      //
      // A WRITE is queued and the message says so, because it is now true.
      // A READ cannot be queued — there is nothing to replay, only data we do
      // not have — so it says something different rather than promising the
      // user their work is safe when no work was done.
      if (QUEUEABLE.has(method) && options.queue !== false && workspace) {
        // Read what is already queued FIRST. Appending to module state that
        // has never been loaded would persist a one-entry queue over an
        // existing one — losing every write made before this session.
        await loadOutbox();
        await enqueue({
          id: options.idempotencyKey ?? newKey(),
          method: method as OutboxEntry['method'],
          path,
          body: options.body ?? null,
          workspaceId: workspace,
        });
        throw new ApiError(
          0,
          'No connection. This is saved and will send by itself when you are back online.',
          'queued',
        );
      }
      throw new ApiError(0, 'No connection. Showing what was last loaded.', 'offline');
    }

    if (!response.ok) {
      let message = `Something went wrong (${response.status}).`;
      let code: string | null = null;
      try {
        const problem = (await response.json()) as { message?: string; error?: string };
        if (typeof problem.message === 'string') message = problem.message;
        if (typeof problem.error === 'string') code = problem.error;
      } catch {
        // A body that is not JSON tells us nothing more than the status did.
      }
      throw new ApiError(response.status, message, code);
    }

    // A response of any kind proves there is a connection, which is the one
    // signal this needs. Deliberately no NetInfo dependency and no polling
    // timer: the app finds out it is online by being used.
    void this.drain();

    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /**
   * Sends anything queued while offline.
   *
   * Guarded against re-entry: every successful request calls this, and a
   * screen that fires six requests at once would otherwise start six drains
   * and send each queued write six times. The idempotency key would keep that
   * correct on the server, but correct-by-retry is not a reason to send the
   * same thing six times over a connection this app cannot rely on.
   */
  private draining = false;

  private async drain(): Promise<void> {
    if (this.draining) return;
    await loadOutbox();
    if (pendingCount() === 0) return;
    this.draining = true;
    try {
      await flush(async (entry): Promise<SendOutcome> => {
        try {
          await this.request(entry.method, entry.path, {
            body: entry.body === null ? undefined : entry.body,
            // The workspace it was QUEUED in, not whichever is active now.
            workspaceId: entry.workspaceId,
            // Its original key, so the server can recognise a write it may
            // already have applied and answer with that outcome.
            idempotencyKey: entry.id,
            // Never re-queue from inside a drain: a failure here means we are
            // offline again, and the entry is already in the queue.
            queue: false,
          });
          return { kind: 'sent' };
        } catch (error) {
          if (error instanceof ApiError && error.status === 0) return { kind: 'offline' };
          return {
            kind: 'rejected',
            message: error instanceof Error ? error.message : 'The server refused it.',
          };
        }
      });
    } finally {
      this.draining = false;
    }
  }

  /** How many writes are waiting to send. For a UI that wants to say so. */
  async pendingWrites(): Promise<number> {
    await loadOutbox();
    return pendingCount();
  }

  private get<T>(path: string, workspaceId?: string | null): Promise<T> {
    return this.request<T>('GET', path, { workspaceId });
  }

  /**
   * Turns a relative URL from the server into one `fetch` or `<Image>` can
   * resolve on its own.
   *
   * The server hands back paths like `/v1/uploads/:token` and, since the
   * Phase 0 signed-URL amendment, `/v1/images/:token` — relative so the app
   * works behind whatever host or tunnel it reached the server through. A
   * `fetch` call resolves a relative path against `this.baseUrl` implicitly
   * (see `request` above); an `<Image source={{uri}}>` has no base of its
   * own to resolve against — on web it becomes a plain `<img src>`, resolved
   * against the PAGE's origin, not the API's — so anything handed to one
   * must be made absolute here first.
   */
  private absolutize(url: string): string {
    return url.startsWith('http') ? url : `${this.baseUrl}${url}`;
  }

  /**
   * Makes every image URL on a `DocumentView` absolute — see `absolutize`.
   *
   * Applied at the transport boundary, not in a screen: the seam promises a
   * URL a UI component can hand straight to `<Image>`, and every caller of
   * every method that can return a document relies on that, not just the
   * review screen that happens to render one today.
   *
   * An empty string is the facsimile convention (§8 amendment, and
   * `receipt.tsx`'s falsy check) — never prefixed, or "no photo" would
   * become a request for `this.baseUrl` itself.
   */
  private hydrateDocument(doc: DocumentView): DocumentView {
    return {
      ...doc,
      imageUrl: doc.imageUrl ? this.absolutize(doc.imageUrl) : doc.imageUrl,
      pages: doc.pages.map((page) =>
        page.imageUrl ? { ...page, imageUrl: this.absolutize(page.imageUrl) } : page,
      ),
    };
  }

  /* ── Resolving a workspace kind to an id ──────────────────────────────── */

  /**
   * Which workspace a kind means.
   *
   * A kind is not an address: someone can own two businesses, and the one the
   * screen means is the one they are looking at. So the ACTIVE workspace wins
   * whenever it is of the right kind, and only otherwise does this fall back
   * to the first of that kind they belong to.
   */
  private async idForKind(kind?: Workspace): Promise<string | null> {
    const active = await awaitWorkspace();
    if (!kind) return active;
    if (this.workspaces.length === 0) await this.listWorkspaces();
    const current = this.workspaces.find((w) => w.id === active);
    if (current?.kind === kind) return active;
    return this.workspaces.find((w) => w.kind === kind)?.id ?? active;
  }

  /* ── Identity ─────────────────────────────────────────────────────────── */

  async getSession(): Promise<Session | null> {
    if (!authToken()) return null;
    try {
      const body = await this.request<{ user: AuthUser; workspaces: WorkspaceSummary[] }>(
        'GET',
        '/v1/auth/session',
        { workspaceId: null },
      );
      this.workspaces = body.workspaces;
      return { user: body.user, workspaceIds: body.workspaces.map((w) => w.id) };
    } catch (error) {
      // An expired or revoked token is "not signed in", not an error to show.
      // Anything else is a real failure and must not be swallowed into a
      // silent sign-out the user cannot explain.
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        setAuthToken(null);
        return null;
      }
      throw error;
    }
  }

  async signIn(email: string): Promise<Session> {
    const body = await this.request<{
      token: string;
      user: AuthUser;
      workspaces: WorkspaceSummary[];
      // `workspaceId: null` matters here and is easy to miss: without it the
      // request waits on `awaitWorkspace()` before it will fire, and at
      // sign-in there is no workspace yet by definition — so every sign-in sat
      // through the full 5s timeout before the POST was even sent. Nobody
      // noticed because it looks like a slow server rather than a client that
      // is waiting for something that cannot arrive.
    }>('POST', '/v1/auth/sign-in', { body: { email }, auth: false, workspaceId: null });

    setAuthToken(body.token);
    this.workspaces = body.workspaces;
    // A returning user lands in a workspace immediately; a new one has none,
    // and the session gate sends them to onboarding.
    setActiveWorkspaceId(body.workspaces[0]?.id ?? null);
    return { user: body.user, workspaceIds: body.workspaces.map((w) => w.id) };
  }

  async signOut(): Promise<void> {
    // Nothing to call: a session is a signed token with no server-side row, so
    // forgetting it IS signing out. Said here rather than left as an empty
    // method somebody later "fixes" by inventing an endpoint.
    setAuthToken(null);
    setActiveWorkspaceId(null);
    this.workspaces = [];
    // A queue is one person's unsent work. Leaving it would send it as
    // whoever signs in next, into whichever workspace they land in.
    await clearOutbox();
  }

  async completeOnboarding(input: OnboardingInput): Promise<Session> {
    const body = await this.request<{
      user: AuthUser;
      workspaces: WorkspaceSummary[];
      workspaceId: string;
    }>('POST', '/v1/workspaces/onboarding', { body: input });
    this.workspaces = body.workspaces;
    setActiveWorkspaceId(body.workspaceId);
    return { user: body.user, workspaceIds: body.workspaces.map((w) => w.id) };
  }

  listDemoAccounts(): Promise<AuthUser[]> {
    return this.request<AuthUser[]>('GET', '/v1/auth/demo-accounts', { auth: false });
  }

  async acceptInvitation(
    token: string,
  ): Promise<{ workspace: WorkspaceSummary; role: MemberRole }> {
    const joined = await this.request<{
      id: string;
      name: string;
      kind: Workspace;
      role: MemberRole;
    }>('POST', '/v1/workspaces/invitations/accept', { body: { token } });
    // The list has changed, so it is re-read rather than patched locally.
    await this.listWorkspaces();
    const workspace =
      this.workspaces.find((w) => w.id === joined.id) ??
      ({ id: joined.id, name: joined.name, kind: joined.kind, role: joined.role, memberCount: 1, abn: null } as WorkspaceSummary);
    return { workspace, role: joined.role };
  }

  /* ── Documents ────────────────────────────────────────────────────────── */

  getOverview(): Promise<Overview> {
    return this.get<Overview>('/v1/overview');
  }

  async listDocuments(
    filter: DocumentFilter = 'all',
    workspace?: Workspace,
  ): Promise<DocumentView[]> {
    const id = await this.idForKind(workspace);
    const list = await this.get<DocumentView[]>(`/v1/documents?filter=${filter}`, id);
    // List rows deliberately carry `pages: []` (same convention as `lines`),
    // so there is nothing to absolutize there — but `imageUrl` is still real
    // and still relative, so every row still needs it.
    return list.map((doc) => this.hydrateDocument(doc));
  }

  async getDocument(id: string): Promise<DocumentView | null> {
    try {
      const doc = await this.get<DocumentView>(`/v1/documents/${id}`);
      return this.hydrateDocument(doc);
    } catch (error) {
      // "No such document" is an answer, not a failure — the seam says null.
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  }

  async updateDocument(id: string, body: UpdateDocumentRequest): Promise<DocumentView> {
    const doc = await this.request<DocumentView>('PATCH', `/v1/documents/${id}`, { body });
    return this.hydrateDocument(doc);
  }

  async confirmDocument(id: string): Promise<DocumentView> {
    const doc = await this.request<DocumentView>('POST', `/v1/documents/${id}/confirm`, { body: {} });
    return this.hydrateDocument(doc);
  }

  async rejectDocument(id: string, reason: string): Promise<void> {
    await this.request('POST', `/v1/documents/${id}/reject`, { body: { reason } });
  }

  async setVisibility(documentId: string, visibility: 'shared' | 'private'): Promise<DocumentView> {
    const doc = await this.request<DocumentView>('PATCH', `/v1/documents/${documentId}/visibility`, {
      body: { visibility },
    });
    return this.hydrateDocument(doc);
  }

  async updateLines(documentId: string, lines: DocumentLine[]): Promise<DocumentView> {
    const doc = await this.request<DocumentView>('PUT', `/v1/documents/${documentId}/lines`, {
      body: { lines },
    });
    return this.hydrateDocument(doc);
  }

  /* ── Capture ──────────────────────────────────────────────────────────── */

  createCapture(body: CreateCaptureRequest): Promise<CreateCaptureResponse> {
    // Deliberately NOT queued. Registering a capture is the first step of a
    // three-part exchange — register, PUT the bytes, wait for extraction —
    // and the bytes are not in this queue and cannot be: a JSON outbox in
    // AsyncStorage is the wrong place for a phone camera's megabytes.
    //
    // Queueing step one alone would produce a capture row on the server with
    // no image behind it: a legal record that says a receipt exists and
    // cannot show it. Offline capture needs its own design, holding the
    // photograph on the filesystem — it is on the roadmap and it is not this.
    return this.request<CreateCaptureResponse>('POST', '/v1/captures', {
      body,
      queue: false,
    });
  }

  async uploadOriginal(uploadUrl: string, bytes: ArrayBuffer, mimeType: string): Promise<void> {
    // The URL is relative so the app works behind whatever host or tunnel it
    // reached the server through. The bytes go up raw, not as JSON or form
    // data: the server hashes exactly what it receives and that hash is the
    // identity of a legal record.
    const url = this.absolutize(uploadUrl);
    const headers: Record<string, string> = { 'Content-Type': mimeType };
    const token = authToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const workspace = await awaitWorkspace();
    if (workspace) headers['X-Workspace-Id'] = workspace;

    const response = await fetch(url, { method: 'PUT', headers, body: bytes });
    if (!response.ok) {
      throw new ApiError(
        response.status,
        response.status === 404
          ? 'That upload link has expired. Take the photo again.'
          : `The image could not be uploaded (${response.status}).`,
        null,
      );
    }
  }

  /**
   * Waits for the worker to finish reading a capture.
   *
   * Polls the capture rather than the document list: in a shared workspace
   * somebody else is capturing at the same time, and "the newest document" is
   * then somebody else's receipt on your review screen.
   *
   * Gives up after roughly ninety seconds. A model call takes two to twenty,
   * so past that something is wrong and saying so beats a spinner that never
   * stops — the image is already stored either way, which is the part that
   * cannot be recreated.
   */
  async awaitExtraction(
    captureId: string,
    _localImageUri?: string,
    workspace?: Workspace,
  ): Promise<DocumentView> {
    const id = await this.idForKind(workspace);
    const deadline = Date.now() + 90_000;
    let wait = 700;

    while (Date.now() < deadline) {
      const progress = await this.get<{
        ready: boolean;
        documentId: string | null;
        error: string | null;
      }>(`/v1/captures/${captureId}`, id);

      if (progress.error) throw new ApiError(422, progress.error, 'extraction_failed');
      if (progress.ready && progress.documentId) {
        const document = await this.get<DocumentView>(`/v1/documents/${progress.documentId}`, id);
        return this.hydrateDocument(document);
      }

      await new Promise((resolve) => setTimeout(resolve, wait));
      // Backing off: the first answer is usually "not yet", and hammering a
      // queue adds load precisely when it is already busy.
      wait = Math.min(wait * 1.5, 4000);
    }
    throw new ApiError(
      504,
      'This is taking longer than expected. Your receipt is saved — check the review list shortly.',
      'extraction_timeout',
    );
  }

  /* ── Personal and analytics ───────────────────────────────────────────── */

  async getPersonal(): Promise<PersonalSummary> {
    return this.get<PersonalSummary>('/v1/personal', await this.idForKind('personal'));
  }

  async setBudget(category: string, monthly: string): Promise<PersonalSummary> {
    const id = await this.idForKind('personal');
    await this.request('PUT', '/v1/budgets', { body: { category, monthly }, workspaceId: id });
    return this.get<PersonalSummary>('/v1/personal', id);
  }

  async getAnalytics(workspace: Workspace, range: AnalyticsRange): Promise<AnalyticsSummary> {
    return this.get<AnalyticsSummary>(
      `/v1/analytics?range=${range}`,
      await this.idForKind(workspace),
    );
  }

  listRecurring(): Promise<Recurring[]> {
    return this.get<Recurring[]>('/v1/recurring');
  }

  /* ── Sales ────────────────────────────────────────────────────────────── */

  getSales(): Promise<SalesSummary> {
    return this.get<SalesSummary>('/v1/sales');
  }

  listInvoices(kind?: 'invoice' | 'estimate'): Promise<Invoice[]> {
    return this.get<Invoice[]>(`/v1/invoices${kind ? `?kind=${kind}` : ''}`);
  }

  async getInvoice(id: string): Promise<Invoice | null> {
    try {
      return await this.get<Invoice>(`/v1/invoices/${id}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  }

  convertEstimate(estimateId: string): Promise<Invoice> {
    return this.request<Invoice>('POST', `/v1/invoices/${estimateId}/convert`, { body: {} });
  }

  listPayments(): Promise<Payment[]> {
    return this.get<Payment[]>('/v1/payments');
  }

  recordPayment(
    invoiceId: string,
    amount: string,
    method: PaymentMethod,
    reference?: string,
  ): Promise<Payment> {
    return this.request<Payment>('POST', '/v1/payments', {
      body: { invoiceId, amount, method, reference },
    });
  }

  listBills(): Promise<Bill[]> {
    return this.get<Bill[]>('/v1/bills');
  }

  payBill(billId: string, amount?: string): Promise<Bill> {
    return this.request<Bill>('POST', `/v1/bills/${billId}/pay`, {
      body: amount === undefined ? {} : { amount },
    });
  }

  /* ── Items, stock, parties ────────────────────────────────────────────── */

  listItems(): Promise<Item[]> {
    return this.get<Item[]>('/v1/items');
  }

  async createItem(item: Omit<Item, 'id' | 'lowStock'>): Promise<Item[]> {
    await this.request('POST', '/v1/items', { body: item });
    return this.listItems();
  }

  async countStock(itemId: string, countedQuantity: number): Promise<Item[]> {
    await this.request('POST', `/v1/items/${itemId}/count`, { body: { countedQuantity } });
    return this.listItems();
  }

  listStockMovements(): Promise<StockMovement[]> {
    return this.get<StockMovement[]>('/v1/stock-movements');
  }

  listParties(kind?: 'customer' | 'supplier'): Promise<Party[]> {
    return this.get<Party[]>(`/v1/parties${kind ? `?kind=${kind}` : ''}`);
  }

  async createParty(party: {
    name: string;
    kind: 'customer' | 'supplier';
    abn?: string | null;
    email?: string | null;
    phone?: string | null;
  }): Promise<Party[]> {
    await this.request('POST', '/v1/parties', { body: party });
    return this.listParties(party.kind);
  }

  /* ── Workspaces and people ────────────────────────────────────────────── */

  async listWorkspaces(): Promise<WorkspaceSummary[]> {
    const list = await this.get<WorkspaceSummary[]>('/v1/workspaces', null);
    this.workspaces = list;
    return list;
  }

  async createWorkspace(name: string, kind: Workspace): Promise<WorkspaceSummary> {
    const made = await this.request<WorkspaceSummary>('POST', '/v1/workspaces', {
      body: { name, kind },
      workspaceId: null,
    });
    await this.listWorkspaces();
    return made;
  }

  getPermissions(workspaceId: string): Promise<Permissions> {
    return this.get<Permissions>(`/v1/workspaces/${workspaceId}/permissions`, workspaceId);
  }

  listMembers(workspaceId: string): Promise<MemberList> {
    return this.get<MemberList>(`/v1/workspaces/${workspaceId}/members`, workspaceId);
  }

  async inviteMember(
    workspaceId: string,
    email: string,
    role: MemberRole,
  ): Promise<MemberList> {
    await this.request('POST', `/v1/workspaces/${workspaceId}/invitations`, {
      body: { email, role },
      workspaceId,
    });
    return this.listMembers(workspaceId);
  }

  async revokeInvitation(workspaceId: string, invitationId: string): Promise<MemberList> {
    await this.request('DELETE', `/v1/workspaces/${workspaceId}/invitations/${invitationId}`, {
      workspaceId,
    });
    return this.listMembers(workspaceId);
  }

  async updateMemberRole(
    workspaceId: string,
    userId: string,
    role: MemberRole,
  ): Promise<MemberList> {
    await this.request('PATCH', `/v1/workspaces/${workspaceId}/members/${userId}`, {
      body: { role },
      workspaceId,
    });
    return this.listMembers(workspaceId);
  }

  async removeMember(workspaceId: string, userId: string): Promise<MemberList> {
    await this.request('DELETE', `/v1/workspaces/${workspaceId}/members/${userId}`, {
      workspaceId,
    });
    return this.listMembers(workspaceId);
  }

  /* ── Mileage ──────────────────────────────────────────────────────────── */

  getMileage(): Promise<MileageSummary> {
    return this.get<MileageSummary>('/v1/mileage');
  }

  async addTrip(trip: Omit<Trip, 'id'>): Promise<MileageSummary> {
    await this.request('POST', '/v1/trips', { body: { ...trip, source: 'manual' } });
    return this.getMileage();
  }

  async deleteTrip(tripId: string): Promise<MileageSummary> {
    await this.request('DELETE', `/v1/trips/${tripId}`);
    return this.getMileage();
  }

  /* ── Goals ────────────────────────────────────────────────────────────── */

  private async goalsFor(): Promise<Goal[]> {
    return this.get<Goal[]>('/v1/goals', await this.idForKind('personal'));
  }

  listGoals(): Promise<Goal[]> {
    return this.goalsFor();
  }

  async createGoal(name: string, target: string, targetDate: string | null): Promise<Goal[]> {
    await this.request('POST', '/v1/goals', {
      body: { name, target, targetDate },
      workspaceId: await this.idForKind('personal'),
    });
    return this.goalsFor();
  }

  async contributeToGoal(goalId: string, amount: string): Promise<Goal[]> {
    await this.request('POST', `/v1/goals/${goalId}/contribute`, {
      body: { amount },
      workspaceId: await this.idForKind('personal'),
    });
    return this.goalsFor();
  }

  async deleteGoal(goalId: string): Promise<Goal[]> {
    await this.request('DELETE', `/v1/goals/${goalId}`, {
      workspaceId: await this.idForKind('personal'),
    });
    return this.goalsFor();
  }

  /* ── Settings ─────────────────────────────────────────────────────────── */

  getBusinessSettings(): Promise<BusinessSettings> {
    return this.get<BusinessSettings>('/v1/settings/business');
  }

  updateBusinessSettings(patch: Partial<BusinessSettings>): Promise<BusinessSettings> {
    // Only the fields the server owns. `workspaceId`, `abnValid` and
    // `occupationLabel` are derived, and sending them back would be asking the
    // server to accept a client's opinion of its own computation.
    const body: Json = {};
    if (patch.name !== undefined) body.name = patch.name;
    if (patch.abn !== undefined) body.abn = patch.abn;
    if (patch.gstRegistered !== undefined) body.gstRegistered = patch.gstRegistered;
    if (patch.gstBasis !== undefined) body.gstBasis = patch.gstBasis;
    if (patch.simplerBas !== undefined) body.simplerBas = patch.simplerBas;
    if (patch.occupationProfileId !== undefined) {
      body.occupationProfileId = patch.occupationProfileId;
    }
    return this.request<BusinessSettings>('PATCH', '/v1/settings/business', { body });
  }

  async listCategorySettings(workspace: Workspace): Promise<CategorySetting[]> {
    return this.get<CategorySetting[]>(
      '/v1/settings/categories',
      await this.idForKind(workspace),
    );
  }

  setCategoryActive(name: string, active: boolean): Promise<CategorySetting[]> {
    return this.request<CategorySetting[]>(
      'PATCH',
      `/v1/settings/categories/${encodeURIComponent(name)}`,
      { body: { active } },
    );
  }

  async createCategory(
    name: string,
    workspace: Workspace,
    monthlyBudget?: string | null,
  ): Promise<CategorySetting[]> {
    const id = await this.idForKind(workspace);
    const list = await this.request<CategorySetting[]>('POST', '/v1/settings/categories', {
      body: { name },
      workspaceId: id,
    });
    if (monthlyBudget == null || monthlyBudget === '') return list;
    // A budget is a separate fact from a category, so it is a separate write.
    await this.request('PUT', '/v1/budgets', {
      body: { category: name, monthly: monthlyBudget },
      workspaceId: id,
    });
    return this.get<CategorySetting[]>('/v1/settings/categories', id);
  }

  /* ── Plan, connections, export ────────────────────────────────────────── */

  getPlanUsage(): Promise<PlanUsage> {
    return this.get<PlanUsage>('/v1/plan');
  }

  listConnections(): Promise<Connection[]> {
    return this.get<Connection[]>('/v1/connections');
  }

  connectAccounting(id: Connection['id']): Promise<{ authorizeUrl: string }> {
    return this.request<{ authorizeUrl: string }>('POST', `/v1/connections/${id}/connect`, {
      body: {},
    });
  }

  disconnectAccounting(id: Connection['id']): Promise<Connection[]> {
    return this.request<Connection[]>('POST', `/v1/connections/${id}/disconnect`, { body: {} });
  }

  getTaxPack(): Promise<TaxPack> {
    return this.get<TaxPack>('/v1/tax-pack');
  }

  async prepareTaxPack(): Promise<TaxPackFile> {
    const file = await this.request<TaxPackFile>('POST', '/v1/tax-pack', { body: {} });
    // The server returns a relative URL so it works behind any host or tunnel.
    // The share sheet needs an absolute one.
    return { ...file, url: this.absolutize(file.url) };
  }
}
