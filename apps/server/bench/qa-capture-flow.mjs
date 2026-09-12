// QA harness: drives the real capture -> upload -> extraction pipeline over
// HTTP, exactly as the mobile client would, but without a browser — used only
// because the Expo web build has no way to trigger a capture (see Lane N QA
// report: capture.tsx has no file-input fallback for web, so the shutter
// always throws "The camera returned no image." in a browser).
//
// Usage: node apps/server/bench/qa-capture-flow.mjs <server-base-url> <image-path>
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4501';
const IMG_PATH = process.argv[3] ?? 'apps/server/bench/receipt.png';

async function main() {
  const bytes = await readFile(IMG_PATH);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  console.log('sha256:', sha256, 'bytes:', bytes.length);

  // Sign in as Kate (owner, tenant 11111111-1111-4111-8111-111111111111)
  const signInRes = await fetch(`${BASE}/v1/auth/sign-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'kate@marshtransport.example' }),
  });
  const signIn = await signInRes.json();
  console.log('signIn status', signInRes.status, JSON.stringify(signIn).slice(0, 200));
  const token = signIn.token;
  const workspaceId = signIn.workspaces?.[0]?.id;
  console.log('workspaceId', workspaceId);

  const headers = {
    Authorization: `Bearer ${token}`,
    'X-Workspace-Id': workspaceId,
    'Content-Type': 'application/json',
  };

  // Register the capture
  const createRes = await fetch(`${BASE}/v1/captures`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      pages: [{ sha256, mimeType: 'image/png', byteSize: bytes.length }],
      capturedAt: new Date().toISOString(),
    }),
  });
  const create = await createRes.json();
  console.log('createCapture status', createRes.status, JSON.stringify(create).slice(0, 400));

  if (create.duplicate) {
    console.log('DUPLICATE — this exact file was already captured for this tenant. Polling its existing capture id.');
  }

  const captureId = create.captureId;
  const uploads = create.uploads ?? [];

  for (const upload of uploads) {
    if (upload.alreadyStored) {
      console.log(`page ${upload.pageNumber} already stored, skipping upload`);
      continue;
    }
    const uploadUrl = upload.uploadUrl.startsWith('http') ? upload.uploadUrl : `${BASE}${upload.uploadUrl}`;
    const putRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png', Authorization: `Bearer ${token}`, 'X-Workspace-Id': workspaceId },
      body: bytes,
    });
    console.log(`PUT page ${upload.pageNumber} ->`, putRes.status);
  }

  // Poll extraction
  const deadline = Date.now() + 60_000;
  let wait = 700;
  let documentId = null;
  while (Date.now() < deadline) {
    const progRes = await fetch(`${BASE}/v1/captures/${captureId}`, { headers });
    const prog = await progRes.json();
    console.log('poll:', JSON.stringify(prog));
    if (prog.error) {
      console.log('EXTRACTION ERROR:', prog.error);
      process.exit(1);
    }
    if (prog.ready && prog.documentId) {
      documentId = prog.documentId;
      break;
    }
    await new Promise((r) => setTimeout(r, wait));
    wait = Math.min(wait * 1.5, 4000);
  }

  if (!documentId) {
    console.log('TIMED OUT waiting for extraction. Note: extraction requires the worker to be running (scripts/work-once.ts).');
    process.exit(1);
  }

  const docRes = await fetch(`${BASE}/v1/documents/${documentId}`, { headers });
  const doc = await docRes.json();
  console.log('document:', JSON.stringify(doc, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
