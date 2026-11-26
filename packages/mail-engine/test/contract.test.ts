import { createMailClient } from "../src/client";
import { createMemoryMailClient } from "../src/testing/memory";
import { describeMailContract } from "./contract";
import { createFakeProxy } from "./fake-proxy";

describeMailContract("real client against the fake proxy (SSE push)", async () => {
  const proxy = createFakeProxy();
  const client = createMailClient({ getSession: async () => proxy.mint(), fetch: proxy.fetch, push: "sse" });
  return {
    client,
    deliver: (subject) => {
      proxy.deliver(subject);
    },
    dispose: () => client.close(),
  };
});

describeMailContract("real client against the fake proxy (poll push)", async () => {
  const proxy = createFakeProxy();
  // pollMs is clamped to 1 s by the client, so this variant's change test waits for a poll.
  const client = createMailClient({ getSession: async () => proxy.mint(), fetch: proxy.fetch, push: "poll", pollMs: 1000 });
  return {
    client,
    deliver: (subject) => {
      proxy.deliver(subject);
    },
    dispose: () => client.close(),
  };
});

describeMailContract("in-memory client", async () => {
  const client = createMemoryMailClient();
  return {
    client,
    deliver: (subject) => {
      client.deliver({ subject });
    },
    dispose: () => client.close(),
  };
});
