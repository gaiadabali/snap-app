import { createElement } from "react";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  MailProvider,
  useFolders,
  useMailClient,
  useMailSummary,
  useMessage,
  useMessageList,
  useSandboxDocument,
  useUnreadCount,
} from "../src/react";
import {
  LIST_PAGE_SIZE,
  createFoldersStore,
  createMessageListStore,
  createMessageStore,
  createSafeHtmlStore,
  createSummaryStore,
} from "../src/state/stores";
import { createMemoryMailClient } from "../src/testing/memory";

function many(n: number): unknown[] {
  return Array.from({ length: n }, (_v, i) => ({
    id: `x${i}`,
    folder: "inbox",
    subject: `Message ${i}`,
    receivedAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
    text: `body ${i}`,
  }));
}

describe("stores (the logic behind the hooks)", () => {
  it("folders: loads while subscribed and follows changes", async () => {
    const client = createMemoryMailClient();
    const store = createFoldersStore(client);
    expect(store.getSnapshot()).toMatchObject({ folders: [], loading: true, error: null });
    const off = store.subscribe(() => {});
    await vi.waitFor(() => expect(store.getSnapshot().loading).toBe(false));
    expect(store.getSnapshot().folders.find((f) => f.key === "inbox")?.unread).toBe(3);
    await client.setRead(["m1"], true);
    await vi.waitFor(() => expect(store.getSnapshot().folders.find((f) => f.key === "inbox")?.unread).toBe(2));
    off();
    // Unsubscribed: no more listening.
    await client.setRead(["m2"], true);
    await new Promise((r) => setTimeout(r, 20));
    expect(store.getSnapshot().folders.find((f) => f.key === "inbox")?.unread).toBe(2);
  });

  it("folders: an error is exposed, not thrown", async () => {
    const client = createMemoryMailClient();
    client.close();
    const store = createFoldersStore(client);
    store.subscribe(() => {});
    await vi.waitFor(() => expect(store.getSnapshot().error?.code).toBe("unavailable"));
    expect(store.getSnapshot().loading).toBe(false);
  });

  it("message list: first page, load more, and refresh on arrival", async () => {
    const client = createMemoryMailClient({ messages: many(120) });
    const store = createMessageListStore(client, "inbox");
    store.subscribe(() => {});
    await vi.waitFor(() => expect(store.getSnapshot().loading).toBe(false));
    expect(store.getSnapshot().items).toHaveLength(LIST_PAGE_SIZE);
    expect(store.getSnapshot().total).toBe(120);

    store.loadMore();
    store.loadMore(); // a second call while one is in flight does nothing
    await vi.waitFor(() => expect(store.getSnapshot().items).toHaveLength(2 * LIST_PAGE_SIZE));
    expect(new Set(store.getSnapshot().items.map((m) => m.id)).size).toBe(2 * LIST_PAGE_SIZE);

    client.deliver({ subject: "Brand new", receivedAt: new Date().toISOString() });
    await vi.waitFor(() => expect(store.getSnapshot().total).toBe(121));
    expect(store.getSnapshot().items[0]?.subject).toBe("Brand new");
    // The refresh kept the pages already loaded.
    expect(store.getSnapshot().items.length).toBeGreaterThanOrEqual(2 * LIST_PAGE_SIZE);
  });

  it("message list: search source, and an empty search never calls the client", async () => {
    const client = createMemoryMailClient();
    const spy = vi.spyOn(client, "search");
    const store = createMessageListStore(client, { search: "invoice" });
    store.subscribe(() => {});
    await vi.waitFor(() => expect(store.getSnapshot().items.map((m) => m.id)).toEqual(["m5"]));

    const blank = createMessageListStore(client, { search: "  " });
    blank.subscribe(() => {});
    expect(blank.getSnapshot()).toEqual({ items: [], total: 0, loading: false, error: null });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("message: loads the detail and reloads when messages change", async () => {
    const client = createMemoryMailClient();
    const store = createMessageStore(client, "m1");
    store.subscribe(() => {});
    await vi.waitFor(() => expect(store.getSnapshot().message?.unread).toBe(true));
    await client.setRead(["m1"], true);
    await vi.waitFor(() => expect(store.getSnapshot().message?.unread).toBe(false));
  });

  it("message: a missing message is an error value", async () => {
    const store = createMessageStore(createMemoryMailClient(), "nope");
    store.subscribe(() => {});
    await vi.waitFor(() => expect(store.getSnapshot().error?.code).toBe("rejected"));
    expect(store.getSnapshot().message).toBeNull();
  });

  it("safe html and summary load once", async () => {
    const client = createMemoryMailClient();
    const html = vi.spyOn(client, "safeHtml");
    const store = createSafeHtmlStore(client, "m12");
    const off = store.subscribe(() => {});
    await vi.waitFor(() => expect(store.getSnapshot().safe?.remoteImagesBlocked).toBe(4));
    off();
    store.subscribe(() => {});
    expect(html).toHaveBeenCalledTimes(1);

    const summary = createSummaryStore(client, "id-ID");
    summary.subscribe(() => {});
    await vi.waitFor(() => expect(summary.getSnapshot().summary?.banner?.ctaLabel).toBe("Mulai beriklan"));
  });
});

describe("hooks, rendered to markup", () => {
  function render(element: ReactElement): string {
    return renderToString(element);
  }

  function Probe(props: { client: ReturnType<typeof createMemoryMailClient> }): ReactElement {
    return createElement(MailProvider, { client: props.client, children: createElement(ProbeBody) });
  }

  function ProbeBody(): ReactElement {
    const folders = useFolders();
    const list = useMessageList("inbox");
    const message = useMessage(null);
    const sandbox = useSandboxDocument("m12", false);
    const unread = useUnreadCount();
    const summary = useMailSummary("en-AU");
    const client = useMailClient();
    return createElement(
      "pre",
      null,
      JSON.stringify({
        folders: folders.loading,
        list: [list.loading, list.items.length],
        message: [message.loading, message.message],
        sandbox: [sandbox.loading, sandbox.doc],
        unread,
        summary: summary.loading,
        hasClient: typeof client.list === "function",
      }),
    );
  }

  it("renders the loading state first and an idle state for a null id or a disabled body", () => {
    const html = render(createElement(Probe, { client: createMemoryMailClient() }));
    // The probe renders one <pre>: take its text and undo the attribute-style escaping.
    const inner = html.slice(html.indexOf(">") + 1, html.lastIndexOf("<"));
    const json = JSON.parse(inner.split("&quot;").join('"')) as Record<string, unknown>;
    expect(json).toEqual({
      folders: true,
      list: [true, 0],
      message: [false, null],
      sandbox: [false, null],
      unread: 0,
      summary: true,
      hasClient: true,
    });
  });

  it("useMailClient outside a provider is a clear error", () => {
    function Bare(): ReactElement {
      useMailClient();
      return createElement("div");
    }
    expect(() => render(createElement(Bare))).toThrow(/MailProvider/);
  });
});
