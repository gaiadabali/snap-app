// An in-memory MailClient with ~20 fixture messages (HTML, attachments,
// List-Unsubscribe, spam, bulk) for UI work and component tests in all three apps.

export { createMemoryMailClient } from "./testing/memory";
export type { MemoryMailClient } from "./testing/memory";
export { MEMORY_ADDRESS, defaultSeeds as memoryFixtures } from "./testing/fixtures";
export type { MemoryAttachmentSeed, MemoryMessageSeed } from "./testing/fixtures";
