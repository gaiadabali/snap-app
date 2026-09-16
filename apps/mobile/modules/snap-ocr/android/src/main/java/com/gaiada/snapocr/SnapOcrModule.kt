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
        detections.add(Detection(scaleBox(lineBox, scaleX, scaleY), words))
      }
    }

    val lines = assembleRows(detections)
    val blocks = if (lines.isEmpty()) emptyList() else listOf(
      mapOf(
        "id" to "blk-p1",
        "kind" to "unknown",
        "page" to 1,
        "order" to 0,
        "box" to unionOf(lines.map { it["box"] as Map<String, Any> }),
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
  private data class Detection(val box: Map<String, Any>, val words: List<Word>)

  /**
   * Group detections into printed ROWS, ordered left to right within each.
   *
   * The same fix the server-side sidecar needed: a detector splits one printed
   * line into several regions, and treating each as its own DocDOM line means a
   * supplier name spread across two of them can never be grounded, because
   * grounding scans runs WITHIN a line. Overlap rather than a pixel tolerance,
   * because line height varies with type size on the same docket.
   */
  private fun assembleRows(detections: List<Detection>): List<Map<String, Any>> {
    val rows = mutableListOf<MutableList<Detection>>()
    for (d in detections.sortedBy { it.box.y() }) {
      val row = rows.firstOrNull { existing ->
        val top = existing.minOf { it.box.y() }
        val bottom = existing.maxOf { it.box.y() + it.box.h() }
        val overlap = min(bottom, d.box.y() + d.box.h()) - max(top, d.box.y())
        val shorter = min(bottom - top, d.box.h())
        shorter > 0 && overlap > 0.5 * shorter
      }
      if (row == null) rows.add(mutableListOf(d)) else row.add(d)
    }

    return rows
      .sortedBy { row -> row.minOf { it.box.y() } }
      .mapIndexed { index, row ->
        val words = row.flatMap { it.words }.sortedBy { it.box.x() }
        mapOf(
          "id" to "ln-p1-$index",
          "order" to index,
          "box" to unionOf(row.map { it.box }),
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
