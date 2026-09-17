-- What phone produced a device reading.
--
-- WHY THIS EXISTS. `docs/ON-DEVICE.md` §1.2 pins the on-device floor at 4 GB,
-- and OD-10 now says openly that the figure is a SUPPORT DECISION rather than
-- a measurement: it came from what Samsung sells in Australian retail, and no
-- build has ever run on a 4 GB handset. The app states the requirement, the
-- website states the requirement, and nobody has evidence for it.
--
-- The phone already knows the answer. `SnapOcrModule.deviceInfo()` reads
-- `ActivityManager.MemoryInfo.totalMem` on every capture and the value reached
-- the API in the OD-7 payload — where it was dropped, because nothing stored
-- it. Computing a number and discarding it is the same shape as the OD-8 bug
-- where the preview was computed and never shown: the work was done and the
-- result never reached anywhere it could be used.
--
-- So the reading now carries its device, and the fleet becomes the instrument
-- the lab cannot be. After a few hundred captures, "is 4 GB the right line"
-- stops being a judgement call and becomes a query.
--
-- ON THE LAYOUT, NOT THE CAPTURE. `captures.device_meta` exists and is `{}` on
-- every row — nothing is plumbed through that API. It is also the wrong home:
-- a capture can be uploaded from one device and re-read later, while a device
-- READING is by definition the product of one phone at one moment. The engine
-- that produced it already lives here in `engine_ids`; the hardware belongs
-- beside it.
--
-- jsonb rather than columns because the shape is the platform's, not ours:
-- Android reports totalMem, iOS will report something else, and a schema that
-- fixes one platform's fields makes the other's arrive as nulls.

ALTER TABLE document_layouts
  ADD COLUMN device_meta jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN document_layouts.device_meta IS
  'Reported by the handset that produced a device reading: platform, osVersion, model, totalMemoryMb. Empty for server-side layouts, which have no device. Never trusted for authorisation — it is what a client said about itself.';

-- Only device readings ever carry this, and they are a small minority of
-- layouts. A partial index keeps it off the server-side rows entirely.
CREATE INDEX document_layouts_device_meta_idx
  ON document_layouts USING gin (device_meta)
  WHERE device_meta <> '{}'::jsonb;
