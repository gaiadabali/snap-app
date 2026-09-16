package com.gaiada.snapocr

import android.app.ActivityManager
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.os.Build
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.math.max
import kotlin.math.min

/**
 * On-device text recognition as DocDOM — docs/ON-DEVICE.md §3.3.
 *
 * ML Kit Text Recognition v2 (Latin), UNBUNDLED: the model arrives via Google
 * Play services, so no proprietary weights enter the APK and the D23 licence
 * floor is untouched. The bundled artefact would put ~4MB of weights per script
 * in the image and would fail that floor — see §5.
 *
 * THE BUG THIS FILE IS WRITTEN AGAINST is coordinates. §3.3 names it: Vision
 * reports normalised bottom-left-origin rectangles, ML Kit rotates by EXIF and
 * reports in the rotated frame, and the module must produce boxes on the pixel
 * grid of the STORED ORIGINAL as the server sees it. Everything below that
 * looks like ceremony — reading EXIF by hand, scaling back by an exact factor —
 * is there because a highlight that lands two centimetres from the total is
 * worse than no highlight at all.
 */
class SnapOcrModule : Module() {

  override fun definition() = ModuleDefinition {
    Name("SnapOcr")

    Function("isAvailable") {
      // Play services may be absent (some Android builds ship without it), in
      // which case the app must behave exactly as it does today rather than
      // showing a broken preview. §9: server-only is a real outcome.
      try {
        TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
        true
      } catch (t: Throwable) {
        false
      }
    }

    Function("deviceInfo") { deviceInfo() }

    AsyncFunction("recognise") { uri: String, options: Map<String, Any?>, promise: expo.modules.kotlin.Promise ->
      val maxLongEdge = (options["maxLongEdge"] as? Number)?.toInt() ?: 2048
      try {
        promise.resolve(recognise(uri, maxLongEdge))
      } catch (t: Throwable) {
        promise.reject("SNAP_OCR_FAILED", t.message ?: t.toString(), t)
      }
    }
  }

  private fun context(): Context = appContext.reactContext
    ?: throw IllegalStateException("no react context")

  private fun deviceInfo(): Map<String, Any> {
    val am = context().getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
    val info = ActivityManager.MemoryInfo()
    am.getMemoryInfo(info)
    return mapOf(
      "platform" to "android",
      "osVersion" to Build.VERSION.RELEASE,
      "model" to "${Build.MANUFACTURER} ${Build.MODEL}",
      // Total RAM, not available RAM. The floor in §1.2 is a 4GB device, and a
      // gate passed on a phone with more is not the gate.
      "totalMemoryMb" to (info.totalMem / (1024L * 1024L)),
    )
  }

  private fun recognise(uri: String, maxLongEdge: Int): Map<String, Any> {
    val started = System.nanoTime()
    val resolved = Uri.parse(uri)

    // Decode bounds first so the ORIGINAL pixel size is known before any
    // downscale — every box is mapped back into this frame.
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    context().contentResolver.openInputStream(resolved).use {
      BitmapFactory.decodeStream(it, null, bounds)
    }
    val rotation = exifRotation(resolved)
    // A 90 or 270 degree EXIF rotation swaps the axes, so the "original" the
    // server stores is the ROTATED one. Getting this backwards is how every
    // box ends up transposed on exactly the photographs taken in portrait.
    val swapped = rotation == 90 || rotation == 270
    val originalWidth = if (swapped) bounds.outHeight else bounds.outWidth
    val originalHeight = if (swapped) bounds.outWidth else bounds.outHeight

    val longest = max(originalWidth, originalHeight)
    val sample = sampleSizeFor(longest, maxLongEdge)
    val decode = BitmapFactory.Options().apply { inSampleSize = sample }
    var bitmap = context().contentResolver.openInputStream(resolved).use {
      BitmapFactory.decodeStream(it, null, decode)
    } ?: throw IllegalStateException("could not decode $uri")

    if (rotation != 0) bitmap = rotate(bitmap, rotation)

    // The EXACT factor, from the bitmap actually recognised back to the
    // original. Derived rather than assumed to be `sample`, because
    // inSampleSize is a hint and the decoder is free to round it.
    val scaleX = originalWidth.toFloat() / bitmap.width.toFloat()
    val scaleY = originalHeight.toFloat() / bitmap.height.toFloat()

    val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    // Rotation is already applied to the bitmap, so ML Kit is told 0 — telling
    // it the EXIF value here would rotate twice.
    val image = InputImage.fromBitmap(bitmap, 0)
    val result = com.google.android.gms.tasks.Tasks.await(recognizer.process(image))

    val detections = mutableListOf<Detection>()
    for (block in result.textBlocks) {
      for (line in block.lines) {
        val lineBox = line.boundingBox ?: continue
        val words = line.elements.mapNotNull { element ->
          val b = element.boundingBox ?: return@mapNotNull null
          Word(element.text, scaleBox(b, scaleX, scaleY), line.confidence ?: 0f)
        }
        if (words.isEmpty()) continue
        detections.add(
          Detection(scaleBox(lineBox, scaleX, scaleY), words, slopeOf(line.cornerPoints)),
        )
      }
    }

    val lines = assembleRows(detections)
    val blocks = if (lines.isEmpty()) emptyList() else listOf(
      mapOf(
        "id" to "blk-p1",
        "kind" to "unknown",
        "page" to 1,
        "order" to 0,
        // Union the DETECTIONS, not the assembled lines. Reaching back into
        // the line maps meant casting `Any?` out of a `Map<String, Any>` --
        // the compiler's only complaint about this file, and a real one: the
        // cast is unchecked, so a future change to the shape `assembleRows`
        // returns would compile cleanly and throw ClassCastException on a
        // phone. A row's box is already the union of its detections, so a
        // union of unions is the same rectangle by construction, and this
        // spelling is type-checked.
        "box" to unionOf(detections.map { it.box }),
        "lines" to lines,
        "provenance" to provenance(1.0),
      ),
    )

    val elapsedMs = (System.nanoTime() - started) / 1_000_000.0
    return mapOf(
      "document" to mapOf(
        "version" to "1.0.0",
        "pages" to listOf(
          mapOf(
            "number" to 1,
            "width" to originalWidth,
            "height" to originalHeight,
            "source" to "camera",
            // What we did to the pixels before reading them, so a later reader
            // knows the boxes were mapped rather than measured.
            "restoration" to listOf("downscale"),
          ),
        ),
        "blocks" to blocks,
        "tables" to emptyList<Any>(),
        "figures" to emptyList<Any>(),
        "fields" to emptyList<Any>(),
        // Platform OCR does not report regions it could not read, so this is
        // empty rather than guessed. §3.3: low confidence rides on the span and
        // the structurer decides what to show.
        "unreadable" to emptyList<Any>(),
      ),
      "device" to deviceInfo(),
      "timings" to mapOf("recogniseMs" to elapsedMs),
    )
  }

  private data class Word(val text: String, val box: Map<String, Any>, val confidence: Float)
  private data class Detection(
    val box: Map<String, Any>,
    val words: List<Word>,
    /** dy/dx of this line's top edge, or null when it is too short to measure. */
    val slope: Double?,
  )

  /**
   * The line's own text angle, from ML Kit's corner points.
   *
   * Points are clockwise from top-left, so the first two are the top edge.
   * Null when the detection is too narrow for corner noise to average out.
   */
  private fun slopeOf(corners: Array<android.graphics.Point>?): Double? {
    if (corners == null || corners.size < 4) return null
    val dx = (corners[1].x - corners[0].x).toDouble()
    val dy = (corners[1].y - corners[0].y).toDouble()
    // ~2 characters at docket scale. Shorter than this and the angle is noise.
    if (kotlin.math.abs(dx) < 24.0) return null
    val slope = dy / dx
    // Past ~30 degrees this is a rotated crop or a vertical label, not skew.
    return if (kotlin.math.abs(slope) <= 0.577) slope else null
  }

  /**
   * Dominant text slope across the page: the MEDIAN of the per-line slopes.
   *
   * THE BUG THIS EXISTS FOR, measured on the handset rather than guessed. The
   * server sidecar had exactly this defect and it cost 13% wrong totals there.
   * On the A71's own reading of `gen-supermarket-0034` the same shape appeared:
   *
   *     TOTAL                  <- no amount on the row at all
   *     GST INCLUDED 29.40     <- 29.40 is the TOTAL, one row too low
   *
   * so the preview reported 29.40 as the GST against a true 2.67, and the
   * total abstained entirely. Across 300 documents the phone filled only 54%
   * of totals, and most of the misses are this: an amount orphaned from its
   * label because the page is a couple of degrees off square.
   *
   * Every hand-held photograph is off square. This is not a corpus artefact.
   */
  private fun pageSkew(detections: List<Detection>): Double {
    val slopes = detections.mapNotNull { it.slope }.sorted()
    if (slopes.isEmpty()) return 0.0
    val mid = slopes.size / 2
    return if (slopes.size % 2 == 1) slopes[mid] else 0.5 * (slopes[mid - 1] + slopes[mid])
  }

  /**
   * Group detections into printed ROWS, ordered left to right within each.
   *
   * Rows are compared on the DESKEWED vertical centre, `y - skew * xc`, which
   * is where the detection would sit had the page been square.
   *
   * Two further rules, both learned from the server sidecar's version of this
   * same function:
   *
   *   * A row is matched against its ANCHOR extent — the first detection placed
   *     in it — never the union of its members. A union grows every time a
   *     taller item joins, so a row chains downwards and swallows the line
   *     beneath it.
   *
   *   * The BEST-overlapping row wins, not the first found. Detections arrive
   *     sorted by y, so "first" systematically favours the row above.
   *
   * The original motivation stands: a detector splits one printed line into
   * several regions, and treating each as its own DocDOM line means a supplier
   * spread across two of them can never be grounded, because grounding scans
   * runs WITHIN a line.
   */
  private fun assembleRows(detections: List<Detection>): List<Map<String, Any>> {
    val skew = pageSkew(detections)
    // (anchorTop, anchorBottom, members) — the anchor is fixed at creation.
    val rows = mutableListOf<Triple<Double, Double, MutableList<Detection>>>()

    fun top(d: Detection) = d.box.y() - skew * (d.box.x() + d.box.w() / 2.0)
    fun bottom(d: Detection) = top(d) + d.box.h()

    for (d in detections.sortedBy { top(it) }) {
      var best: Triple<Double, Double, MutableList<Detection>>? = null
      var bestRatio = 0.0
      for (row in rows) {
        val overlap = min(row.second, bottom(d)) - max(row.first, top(d))
        val shorter = min(row.second - row.first, d.box.h())
        if (shorter <= 0) continue
        val ratio = overlap / shorter
        if (ratio > 0.5 && ratio > bestRatio) {
          best = row
          bestRatio = ratio
        }
      }
      if (best == null) rows.add(Triple(top(d), bottom(d), mutableListOf(d)))
      else best.third.add(d)
    }

    return rows
      .sortedBy { it.first }
      .mapIndexed { index, row ->
        val words = row.third.flatMap { it.words }.sortedBy { it.box.x() }
        mapOf(
          "id" to "ln-p1-$index",
          "order" to index,
          "box" to unionOf(row.third.map { it.box }),
          "spans" to words.mapIndexed { wi, w ->
            mapOf(
              "id" to "sp-p1-l$index-w$wi",
              "text" to w.text,
              "box" to w.box,
              // ML Kit scores a LINE, not a word, so every span on a line
              // repeats its line's confidence. Repeating it is honest about
              // what was measured; inventing a per-word number would not be.
              "provenance" to provenance(w.confidence.toDouble()),
            )
          },
        )
      }
  }

  private fun provenance(confidence: Double) = mapOf(
    "engine" to "device-mlkit",
    "confidence" to confidence,
    // Never calibrated. D20's curve does not exist yet, and claiming otherwise
    // would make a 0.9 from this engine look like a 0.9 from a calibrated one.
    "calibrated" to false,
  )

  private fun Map<String, Any>.x() = (this["x"] as Number).toDouble()
  private fun Map<String, Any>.y() = (this["y"] as Number).toDouble()
  private fun Map<String, Any>.w() = (this["width"] as Number).toDouble()
  private fun Map<String, Any>.h() = (this["height"] as Number).toDouble()

  private fun unionOf(boxes: List<Map<String, Any>>): Map<String, Any> {
    val x = boxes.minOf { it.x() }
    val y = boxes.minOf { it.y() }
    val right = boxes.maxOf { it.x() + it.w() }
    val bottom = boxes.maxOf { it.y() + it.h() }
    return mapOf("x" to x, "y" to y, "width" to right - x, "height" to bottom - y)
  }

  private fun scaleBox(r: android.graphics.Rect, sx: Float, sy: Float): Map<String, Any> = mapOf(
    "x" to r.left * sx.toDouble(),
    "y" to r.top * sy.toDouble(),
    "width" to r.width() * sx.toDouble(),
    "height" to r.height() * sy.toDouble(),
  )

  private fun sampleSizeFor(longest: Int, maxLongEdge: Int): Int {
    var sample = 1
    while (longest / sample > maxLongEdge) sample *= 2
    return sample
  }

  private fun exifRotation(uri: Uri): Int =
    context().contentResolver.openInputStream(uri).use { stream ->
      if (stream == null) return 0
      when (ExifInterface(stream).getAttributeInt(
        ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL,
      )) {
        ExifInterface.ORIENTATION_ROTATE_90 -> 90
        ExifInterface.ORIENTATION_ROTATE_180 -> 180
        ExifInterface.ORIENTATION_ROTATE_270 -> 270
        else -> 0
      }
    }

  private fun rotate(bitmap: Bitmap, degrees: Int): Bitmap {
    val matrix = Matrix().apply { postRotate(degrees.toFloat()) }
    return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
  }
}
