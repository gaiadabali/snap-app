package com.gaiada.snapocr.ppocr

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.app.ActivityManager
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.BufferedReader
import kotlin.math.max

/**
 * `SnapOcrPpocr` — the native half of OD-14 (`docs/ON-DEVICE.md` §11 Stage 3).
 *
 * WHY A SEPARATE MODULE FROM `SnapOcrModule` (ML Kit). `device-mlkit` does
 * decode → recognise → assemble in one native call because ML Kit's own
 * `TextRecognizer` is a single opaque step. PP-OCR is not: detection and
 * recognition are two separate ONNX sessions, and the session itself has to
 * be RUN FROM JAVASCRIPT, because that is what `onnxruntime-react-native`
 * exposes (docs/ON-DEVICE.md §4's own reason for naming that package: it
 * "stays managed" as an Expo config plugin, rather than pulling the raw
 * ONNX Runtime Android AAR into this module's own `build.gradle`). So the
 * pixel-heavy, per-model-input work below is native (decode, EXIF, downscale,
 * det/rec tensor prep, DB post-process, crop-warp, CTC decode — the parts a
 * phone's CPU should do, and the parts `Geometry.kt`/`DbPostProcess.kt`/
 * `CtcDecode.kt` could be unit-tested without a device), while the actual
 * `session.run()` calls happen in the `../src/ppocr` TypeScript sources,
 * which is the only place `onnxruntime-react-native`'s JS API is reachable
 * from.
 *
 * FLAG. This module does nothing unless `../src/ppocr/config.ts`'s
 * `PPOCR_ENABLED` is true, which it is not by default (docs/ON-DEVICE.md OD-14
 * ticket: "wired behind a flag defaulting OFF"). Registering it here changes
 * nothing for `device-mlkit`, which this file never touches.
 */
class PpocrModule : Module() {

    override fun definition() = ModuleDefinition {
        Name("SnapOcrPpocr")

        // Duplicated from `SnapOcrModule.deviceInfo` rather than shared,
        // deliberately: this module must stand alone from JS without
        // reaching back into the ML Kit module or creating an import cycle
        // between this file and `../src/index.ts`. Same shape, same fields,
        // same reasoning (§1.2's floor is measured `totalMemoryMb`, not the
        // spec sheet) — see that file if the two ever need to be reconciled.
        Function("deviceInfo") { deviceInfo() }

        Function("isDictionaryAvailable") {
            try {
                loadDictionary()
                true
            } catch (t: Throwable) {
                false
            }
        }

        AsyncFunction("loadDictionary") { promise: expo.modules.kotlin.Promise ->
            try {
                promise.resolve(loadDictionary())
            } catch (t: Throwable) {
                promise.reject("SNAP_OCR_PPOCR_DICT_FAILED", t.message ?: t.toString(), t)
            }
        }

        AsyncFunction("prepareDetTensor") { uri: String, options: Map<String, Any?>, promise: expo.modules.kotlin.Promise ->
            try {
                val maxLongEdge = (options["maxLongEdge"] as? Number)?.toInt() ?: 2048
                val limitSideLen = (options["limitSideLen"] as? Number)?.toInt() ?: 960
                val decoded = decodeDownscaled(uri, maxLongEdge)
                val tensor = PpocrTensors.detTensor(decoded.bitmap, limitSideLen)
                promise.resolve(
                    mapOf(
                        "data" to tensor.data,
                        "width" to tensor.width,
                        "height" to tensor.height,
                        // The frame `DbPostProcess.detect`'s quads come back
                        // in BEFORE this function's own resize — i.e. the
                        // recognised-copy frame, not the original page.
                        "recognisedWidth" to decoded.bitmap.width,
                        "recognisedHeight" to decoded.bitmap.height,
                        // Exact factors back to the ORIGINAL page, mirroring
                        // `SnapOcrModule.recognise`'s `scaleX`/`scaleY`.
                        "originalWidth" to decoded.originalWidth,
                        "originalHeight" to decoded.originalHeight,
                        "scaleX" to decoded.originalWidth.toDouble() / decoded.bitmap.width.toDouble(),
                        "scaleY" to decoded.originalHeight.toDouble() / decoded.bitmap.height.toDouble(),
                    ),
                )
                decoded.bitmap.recycle()
            } catch (t: Throwable) {
                promise.reject("SNAP_OCR_PPOCR_DET_PREP_FAILED", t.message ?: t.toString(), t)
            }
        }

        Function("dbPostprocess") { args: Map<String, Any?> ->
            @Suppress("UNCHECKED_CAST")
            val prob = (args["prob"] as List<Double>).let { FloatArray(it.size) { i -> it[i].toFloat() } }
            val bitmapWidth = (args["bitmapWidth"] as Number).toInt()
            val bitmapHeight = (args["bitmapHeight"] as Number).toInt()
            val destWidth = (args["destWidth"] as Number).toInt()
            val destHeight = (args["destHeight"] as Number).toInt()
            val detections = DbPostProcess.detect(prob, bitmapWidth, bitmapHeight, destWidth, destHeight)
            detections.map { d ->
                mapOf(
                    "score" to d.score,
                    "box" to d.quad.points.flatMap { listOf(it.x, it.y) },
                )
            }
        }

        AsyncFunction("prepareRecTensor") { uri: String, args: Map<String, Any?>, promise: expo.modules.kotlin.Promise ->
            try {
                // `box` is 8 numbers [tlX,tlY,trX,trY,brX,brY,blX,blY] in the
                // SAME frame `prepareDetTensor` reported as `recognisedWidth`/
                // `recognisedHeight` — the caller must not have scaled it to
                // the original page yet. See `PpocrTensors.cropWarp`'s own
                // warning.
                @Suppress("UNCHECKED_CAST")
                val box = (args["box"] as List<Number>).map { it.toDouble() }
                require(box.size == 8) { "box must have 8 numbers (4 points)" }
                val quad = Quad(
                    listOf(
                        Point(box[0], box[1]), Point(box[2], box[3]),
                        Point(box[4], box[5]), Point(box[6], box[7]),
                    ),
                )
                val maxLongEdge = (args["maxLongEdge"] as? Number)?.toInt() ?: 2048
                val decoded = decodeDownscaled(uri, maxLongEdge)
                val strip = PpocrTensors.cropWarp(decoded.bitmap, quad)
                val tensor = PpocrTensors.recTensor(strip)
                promise.resolve(mapOf("data" to tensor.data, "width" to tensor.width, "height" to tensor.height))
                strip.recycle()
                decoded.bitmap.recycle()
            } catch (t: Throwable) {
                promise.reject("SNAP_OCR_PPOCR_REC_PREP_FAILED", t.message ?: t.toString(), t)
            }
        }

        Function("ctcDecode") { args: Map<String, Any?> ->
            // The dictionary is loaded and cached NATIVELY (`cachedVocab`)
            // rather than round-tripped through JS on every line: it is
            // 6906 strings, and a receipt can have 20-40 lines, so passing
            // it back on every call would cost far more bridge traffic than
            // the decode itself. `loadDictionary()` remains exposed to JS
            // separately, for the one-time vocab-size sanity check against
            // the rec model's own output width before any inference runs.
            @Suppress("UNCHECKED_CAST")
            val logits = (args["logits"] as List<Double>).let { FloatArray(it.size) { i -> it[i].toFloat() } }
            val timesteps = (args["timesteps"] as Number).toInt()
            val vocab = cachedVocab()
            val result = CtcDecode.decode(logits, timesteps, vocab.size, vocab)
            mapOf("text" to result.text, "confidence" to result.confidence)
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
            "totalMemoryMb" to (info.totalMem / (1024L * 1024L)),
        )
    }

    private var vocabCache: List<String>? = null

    private fun cachedVocab(): List<String> = vocabCache ?: loadDictionary().also { vocabCache = it }

    private fun loadDictionary(): List<String> {
        val text = context().assets.open("ppocrv6_tiny_dict.txt").bufferedReader(Charsets.UTF_8)
            .use(BufferedReader::readText)
        val vocab = Dictionary.parse(text)
        check(vocab.size == Dictionary.EXPECTED_SIZE) {
            "ppocrv6_tiny_dict.txt parsed to ${vocab.size} entries, expected ${Dictionary.EXPECTED_SIZE} " +
                "— the bundled dictionary does not match the model this module targets"
        }
        return vocab
    }

    /** Same decode → EXIF-correct → downscale steps as `SnapOcrModule.recognise`. */
    private data class Decoded(val bitmap: Bitmap, val originalWidth: Int, val originalHeight: Int)

    private fun decodeDownscaled(uri: String, maxLongEdge: Int): Decoded {
        val resolved = Uri.parse(uri)
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        context().contentResolver.openInputStream(resolved).use {
            BitmapFactory.decodeStream(it, null, bounds)
        }
        val rotation = exifRotation(resolved)
        val swapped = rotation == 90 || rotation == 270
        val originalWidth = if (swapped) bounds.outHeight else bounds.outWidth
        val originalHeight = if (swapped) bounds.outWidth else bounds.outHeight

        val longest = max(originalWidth, originalHeight)
        var sample = 1
        while (longest / sample > maxLongEdge) sample *= 2
        val decode = BitmapFactory.Options().apply { inSampleSize = sample }
        var bitmap = context().contentResolver.openInputStream(resolved).use {
            BitmapFactory.decodeStream(it, null, decode)
        } ?: throw IllegalStateException("could not decode $uri")
        if (rotation != 0) {
            val matrix = Matrix().apply { postRotate(rotation.toFloat()) }
            val rotated = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
            if (rotated !== bitmap) bitmap.recycle()
            bitmap = rotated
        }
        return Decoded(bitmap, originalWidth, originalHeight)
    }

    private fun exifRotation(uri: Uri): Int =
        context().contentResolver.openInputStream(uri).use { stream ->
            if (stream == null) return 0
            when (
                ExifInterface(stream).getAttributeInt(
                    ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL,
                )
            ) {
                ExifInterface.ORIENTATION_ROTATE_90 -> 90
                ExifInterface.ORIENTATION_ROTATE_180 -> 180
                ExifInterface.ORIENTATION_ROTATE_270 -> 270
                else -> 0
            }
        }
}
