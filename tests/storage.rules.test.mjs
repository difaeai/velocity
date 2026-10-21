/**
 * Storage security-rules tests. Run with:
 *   firebase emulators:exec --only storage --project demo-velocity \
 *     "node --test tests/storage.rules.test.mjs"
 *
 * Covers the private upload paths: who may write what type, and who may read
 * it back. Production uploads are all JPEG/PNG today (checked against the
 * bucket on 2026-09-28), which is what the type caps are measured against.
 */
import { readFileSync } from 'node:fs';
import test, { after } from 'node:test';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { getMetadata, ref, uploadBytes } from 'firebase/storage';

const [host, port] = (process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? '127.0.0.1:9199').split(':');

const testEnv = await initializeTestEnvironment({
  projectId: process.env.GCLOUD_PROJECT ?? 'demo-velocity',
  storage: {
    rules: readFileSync(new URL('../storage.rules', import.meta.url), 'utf8'),
    host,
    port: Number(port),
  },
});

after(() => testEnv.cleanup());

const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);

const owner = testEnv.authenticatedContext('user1').storage();
const stranger = testEnv.authenticatedContext('user2').storage();
const admin = testEnv.authenticatedContext('admin1', { role: 'admin' }).storage();

const put = (storage, path, contentType) => uploadBytes(ref(storage, path), BYTES, { contentType });
const read = (storage, path) => getMetadata(ref(storage, path));

// Files to read back, written with rules bypassed.
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const s = ctx.storage();
  await put(s, 'drivers/user1/documents/licence-1', 'image/jpeg');
  await put(s, 'specialRides/user1/documents/insurance-1', 'image/jpeg');
});

test('driver documents: images and PDF from the owner, nothing active', async () => {
  await assertSucceeds(put(owner, 'drivers/user1/documents/a', 'image/jpeg'));
  await assertSucceeds(put(owner, 'drivers/user1/documents/b', 'image/png'));
  await assertSucceeds(put(owner, 'drivers/user1/documents/c', 'application/pdf'));
  await assertFails(put(owner, 'drivers/user1/documents/d', 'text/html'));
  await assertFails(put(owner, 'drivers/user1/documents/e', 'application/octet-stream'));
  await assertFails(put(stranger, 'drivers/user1/documents/f', 'image/jpeg'));
});

test('driver documents: read back only by the owner and admins', async () => {
  await assertSucceeds(read(owner, 'drivers/user1/documents/licence-1'));
  await assertSucceeds(read(admin, 'drivers/user1/documents/licence-1'));
  await assertFails(read(stranger, 'drivers/user1/documents/licence-1'));
});

// The ride dash cam. Only the driver writes, each clip once, named by the time
// it started; nobody reads back through the rules, because getDashcamClips is
// what decides who may watch which clip.
test('dash cam clips: the driver creates each clip once, nobody reads them back', async () => {
  const clip = 'dashcam/user1/trip1/1760000000000.mp4';
  await assertSucceeds(put(owner, clip, 'video/mp4'));
  // Never replaced after the fact — the evidence stays what was recorded.
  await assertFails(put(owner, clip, 'video/mp4'));
  await assertFails(put(owner, 'dashcam/user1/trip1/1760000000001.mov', 'video/mp4'));
  await assertFails(put(owner, 'dashcam/user1/trip1/clip.mp4', 'video/mp4'));
  await assertFails(put(owner, 'dashcam/user1/trip1/1760000000002.mp4', 'text/html'));
  await assertFails(put(stranger, 'dashcam/user1/trip1/1760000000003.mp4', 'video/mp4'));
  await assertFails(read(owner, clip));
  await assertFails(read(stranger, clip));
  await assertFails(read(admin, clip));
});

test('special rides papers: images from the owner only', async () => {
  await assertSucceeds(put(owner, 'specialRides/user1/documents/insurance-2', 'image/jpeg'));
  await assertSucceeds(put(owner, 'specialRides/user1/documents/registration-2', 'image/png'));
  await assertFails(put(owner, 'specialRides/user1/documents/x', 'application/pdf'));
  await assertFails(put(owner, 'specialRides/user1/documents/y', 'text/html'));
  await assertFails(put(stranger, 'specialRides/user1/documents/z', 'image/jpeg'));
  // Nothing else under specialRides/ is writable.
  await assertFails(put(owner, 'specialRides/user1/other/p', 'image/jpeg'));
});

test('special rides papers: never readable by another user', async () => {
  await assertSucceeds(read(owner, 'specialRides/user1/documents/insurance-1'));
  await assertSucceeds(read(admin, 'specialRides/user1/documents/insurance-1'));
  await assertFails(read(stranger, 'specialRides/user1/documents/insurance-1'));
});

// A post or a story publishes an image and nothing else, so refusing images
// here left both formats with no way to be finished from the queue.
test('social uploads: video and images from admins only', async () => {
  await assertSucceeds(put(admin, 'socialUploads/p-1-cut.mp4', 'video/mp4'));
  await assertSucceeds(put(admin, 'socialUploads/p-2-frame.jpg', 'image/jpeg'));
  await assertSucceeds(put(admin, 'socialUploads/p-3-frame.png', 'image/png'));
  await assertFails(put(admin, 'socialUploads/p-4-page.html', 'text/html'));
  await assertFails(put(owner, 'socialUploads/p-5-frame.jpg', 'image/jpeg'));
});

test('unchanged paths keep working', async () => {
  await assertSucceeds(put(owner, 'cnic/user1/front-1', 'image/jpeg'));
  await assertFails(put(owner, 'cnic/user1/front-2', 'application/pdf'));
  // Chat attachments carry documents of any type; car photos go here too.
  await assertSucceeds(put(owner, 'travelMateChat/user1/file.pdf', 'application/pdf'));
  await assertSucceeds(put(owner, 'travelMateChat/user1/car.jpg', 'image/jpeg'));
});

// Attack 10 (see backend/functions/src/__tests__/abuse.test.ts for the list):
// host a phishing page on our bucket. A download link to an HTML or SVG file is
// served from a Google domain and opens as a web page, so nothing a browser
// would render as a page may be uploaded — chat files may be any other type.
test('Attack 10: nobody can upload a web page or SVG to host phishing on our bucket', async () => {
  await assertFails(put(owner, 'travelMateChat/user1/login.html', 'text/html'));
  await assertFails(put(owner, 'travelMateChat/user1/x.svg', 'image/svg+xml'));
  await assertFails(put(owner, 'travelMateChat/user1/x.xhtml', 'application/xhtml+xml'));
  await assertFails(put(owner, 'users/user1/avatar/me.svg', 'image/svg+xml'));
  await assertFails(put(owner, 'businessAdMedia/user1/offer.svg', 'image/svg+xml'));

  await assertSucceeds(put(owner, 'travelMateChat/user1/ticket.pdf', 'application/pdf'));
  await assertSucceeds(put(owner, 'travelMateChat/user1/sheet.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
  await assertSucceeds(put(owner, 'travelMateChat/user1/photo.jpg', 'image/jpeg'));
  await assertSucceeds(put(owner, 'users/user1/avatar/me.png', 'image/png'));
});
