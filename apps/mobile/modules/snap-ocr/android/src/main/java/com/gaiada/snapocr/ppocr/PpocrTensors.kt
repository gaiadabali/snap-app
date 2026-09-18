package com.gaiada.snapocr.ppocr

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import kotlin.math.ceil
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Bitmap-level pre/post steps for PP-OCRv6 — the half of OD-14 that CANNOT be
 * a JVM unit test, because it needs `android.graphics`, which needs a device
 * or an instrumented emulator. `Geometry.kt`, `DbPostProcess.kt` and
 * `CtcDecode.kt` carry the parts that could be checked without one; this file
 * is the part that could not be, and says so rather than implying otherwise.
 *
 * Every numeric constant here is read from
 * `configs/det/PP-OCRv6/PP-OCRv6_tiny_det.yml` and
 * `configs/rec/PP-OCRv6/PP-OCRv6_tiny_rec.yml` (Apache-2.0,
 * PaddlePaddle/PaddleOCR) and cross-checked against the published ONNX
 * graphs' own input shapes on 2026-09-18 — det takes `x: [N,3,H,W]` with H
 * and W fully dynamic, rec takes `x: [N,3,48,W]` with only W dynamic, which
 * is why height 48 is fixed below and det's resize only has to land on a
 * multiple of 32.
 */
object PpocrTensors {

    /** ImageNet stats — `NormalizeImage` in the det training/eval config. */
    private val DET_MEAN = floatArrayOf(0.485f, 0.456f, 0.406f)
    private val DET_STD = floatArrayOf(0.229f, 0.224f, 0.225f)

    data class DetTensor(val data: FloatArray, val width: Int, val height: Int)
    data class RecTensor(val data: FloatArray, val width: Int, val height: Int)

    /**
     * Resize so the longer side is `limitSideLen` (our own choice — the
     * upstream config only fixes normalization, not this bound; 960 matches
     * what the reference Python run used against the bench receipts), then
     * round BOTH sides to a multiple of 32 (`DetResizeForTest.resize_image_type0`,
     * `ppocr/data/imaug/operators.py` — the rounding rule is load-bearing,
     * the 960 is not), then normalize to CHW float32.
     *
     * The returned `width`/`height` are the network's own input size, i.e.
     * `DbPostProcess.detect`'s `bitmapWidth`/`bitmapHeight` — NOT the
     * original page. Callers scale the resulting quads back through whatever
     * downscale they applied before calling this (mirroring
     * `SnapOcrModule.recognise`'s `scaleX`/`scaleY`), then again through
     * this function's own resize, which is why `DbPostProcess.detect` takes
     * both a bitmap frame and a destination frame.
     */
    fun detTensor(bitmap: Bitmap, limitSideLen: Int = 960): DetTensor {
        val w = bitmap.width
        val h = bitmap.height
        val ratio = if (max(w, h) > limitSideLen) limitSideLen.toDouble() / max(w, h) else 1.0
        val resizeW = max(32, (Math.round(w * ratio / 32.0) * 32).toInt())
        val resizeH = max(32, (Math.round(h * ratio / 32.0) * 32).toInt())

        val resized = Bitmap.createScaledBitmap(bitmap, resizeW, resizeH, true)
        val pixels = IntArray(resizeW * resizeH)
        resized.getPixels(pixels, 0, resizeW, 0, 0, resizeW, resizeH)
        if (resized !== bitmap) resized.recycle()

        // CHW: all R, then all G, then all B — matches `ToCHWImage` after an
        // HWC `NormalizeImage`.
        val plane = resizeW * resizeH
        val data = FloatArray(3 * plane)
        for (i in pixels.indices) {
            val p = pixels[i]
            val r = ((p shr 16) and 0xFF) / 255f
            val g = ((p shr 8) and 0xFF) / 255f
            val b = (p and 0xFF) / 255f
            data[i] = (r - DET_MEAN[0]) / DET_STD[0]
            data[plane + i] = (g - DET_MEAN[1]) / DET_STD[1]
            data[2 * plane + i] = (b - DET_MEAN[2]) / DET_STD[2]
        }
        return DetTensor(data, resizeW, resizeH)
    }

    /**
     * Crop-and-warp one detected quad into an upright strip, then normalize
     * for the recogniser.
     *
     * THE COORDINATE BUG THIS FUNCTION IS WRITTEN AGAINST: `quad` must
     * already be in `bitmap`'s own pixel space (i.e. the same frame
     * `DbPostProcess.detect` was told to map INTO via `destWidth`/`destHeight`
     * — callers pass the recognised-copy bitmap and its own quads here,
     * BEFORE scaling anything back to the original page. Warping against the
     * wrong frame produces a crop that looks plausible and reads the wrong
     * fifteen characters, which is worse than an obviously broken crop.
     *
     * Perspective mapping is `Matrix.setPolyToPoly` (Android's own general
     * 4-point projective solve) rather than a hand-rolled homography —
     * fewer places for this file to get wrong, since Android's own graphics
     * pipeline supplies the warp.
     */
    fun cropWarp(bitmap: Bitmap, quad: Quad, targetHeight: Int = 48): Bitmap {
        // NOT `val (tl, tr, br, bl) = quad`. `Quad` is a data class over a
        // single `points: List<Point>` constructor property, so Kotlin
        // auto-generates ITS OWN `component1()` returning that list — which
        // wins over a same-named extension function (a member always beats
        // an extension in overload resolution). Destructuring here silently
        // bound `tl` to `List<Point>` instead of a `Point`, and every `tl.x`/
        // `tl.y` below failed to resolve while `tr`/`br`/`bl` (component2-4,
        // no member to collide with) worked fine — caught by the WSL Gradle
        // build, not by inspection. Named property access has no such trap.
        val tl = quad.topLeft
        val tr = quad.topRight
        val br = quad.bottomRight
        val bl = quad.bottomLeft
        val widthTop = hypot(tr.x - tl.x, tr.y - tl.y)
        val widthBottom = hypot(br.x - bl.x, br.y - bl.y)
        val heightLeft = hypot(bl.x - tl.x, bl.y - tl.y)
        val heightRight = hypot(br.x - tr.x, br.y - tr.y)
        val srcWidth = max(widthTop, widthBottom).let { if (it < 1.0) 1.0 else it }
        val srcHeight = max(heightLeft, heightRight).let { if (it < 1.0) 1.0 else it }

        val src = floatArrayOf(
            tl.x.toFloat(), tl.y.toFloat(),
            tr.x.toFloat(), tr.y.toFloat(),
            br.x.toFloat(), br.y.toFloat(),
            bl.x.toFloat(), bl.y.toFloat(),
        )
        val dst = floatArrayOf(
            0f, 0f,
            srcWidth.toFloat(), 0f,
            srcWidth.toFloat(), srcHeight.toFloat(),
            0f, srcHeight.toFloat(),
        )
        val matrix = Matrix()
        // Maps `src` (a quad inside `bitmap`) onto `dst` (an axis-aligned
        // rectangle), so `drawBitmap(bitmap, matrix, paint)` paints the
        // straightened line into the destination canvas.
        matrix.setPolyToPoly(src, 0, dst, 0, 4)

        val straightened = Bitmap.createBitmap(
            ceil(srcWidth).toInt().coerceAtLeast(1),
            ceil(srcHeight).toInt().coerceAtLeast(1),
            Bitmap.Config.ARGB_8888,
        )
        Canvas(straightened).drawBitmap(bitmap, matrix, Paint(Paint.FILTER_BITMAP_FLAG))

        val outWidth = max(1, ((srcWidth / srcHeight) * targetHeight).roundToInt())
        val resized = Bitmap.createScaledBitmap(straightened, outWidth, targetHeight, true)
        if (resized !== straightened) straightened.recycle()
        return resized
    }

    /**
     * Normalizes an already-cropped, already-height-48 strip for the
     * recogniser: scale to [0,1], then `(x - 0.5) / 0.5` → [-1,1]
     * (`resize_norm_img`, `ppocr/data/imaug/rec_img_aug.py`), CHW.
     */
    fun recTensor(strip: Bitmap): RecTensor {
        val w = strip.width
        val h = strip.height
        val pixels = IntArray(w * h)
        strip.getPixels(pixels, 0, w, 0, 0, w, h)
        val plane = w * h
        val data = FloatArray(3 * plane)
        for (i in pixels.indices) {
            val p = pixels[i]
            val r = ((p shr 16) and 0xFF) / 255f
            val g = ((p shr 8) and 0xFF) / 255f
            val b = (p and 0xFF) / 255f
            data[i] = (r - 0.5f) / 0.5f
            data[plane + i] = (g - 0.5f) / 0.5f
            data[2 * plane + i] = (b - 0.5f) / 0.5f
        }
        return RecTensor(data, w, h)
    }
}
