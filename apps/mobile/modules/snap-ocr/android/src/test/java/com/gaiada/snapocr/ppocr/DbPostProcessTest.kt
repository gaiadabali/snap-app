package com.gaiada.snapocr.ppocr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM-only tests for `DbPostProcess.detect` against SYNTHETIC probability
 * maps — this proves the thresholding / connected-components / scoring /
 * unclip / coordinate-mapping arithmetic matches the ported algorithm's own
 * numbers. It does NOT prove a real PP-OCRv6 det model's actual output
 * behaves like these hand-built maps; that was checked separately by running
 * the Python reference (numpy + onnxruntime + opencv + pyclipper) against
 * `apps/server/bench/receipt.png` during development, which is not something
 * a JVM test can pull in. See `DbPostProcess.kt`'s own doc comment.
 */
class DbPostProcessTest {

    private fun uniformMap(width: Int, height: Int, background: Float, block: IntArray) =
        FloatArray(width * height) { idx ->
            val x = idx % width
            val y = idx / width
            if (x in block[0]..block[2] && y in block[1]..block[3]) 0.9f else background
        }

    @Test
    fun `finds one box around a single bright rectangle and grows it by unclip`() {
        val width = 100
        val height = 60
        // A solid block at x in [20,70], y in [20,40] -- area 51*21=1071 in
        // pixel-count terms; DbPostProcess measures the CONVEX HULL area of
        // that block, which for a filled axis-aligned rectangle of member
        // points 20..70 x 20..40 is exactly 50 x 20 = 1000 (hull spans
        // corner-to-corner, i.e. one pixel short of the block's own count).
        val prob = uniformMap(width, height, 0.05f, intArrayOf(20, 20, 70, 40))

        val detections = DbPostProcess.detect(prob, width, height, width, height)
        assertEquals(1, detections.size)

        val box = detections[0].quad
        // Raw box: x[20,70] y[20,40] -> area 1000, perimeter 140,
        // distance = 1000 * 1.4 / 140 = 10 -> grown by 10 on every side.
        assertEquals(10.0, box.topLeft.x, 1.5)
        assertEquals(10.0, box.topLeft.y, 1.5)
        assertEquals(80.0, box.bottomRight.x, 1.5)
        assertEquals(50.0, box.bottomRight.y, 1.5)
        assertTrue("score should be near the block's own probability", detections[0].score > 0.8)
    }

    @Test
    fun `two separated bright rectangles produce two detections`() {
        val width = 200
        val height = 60
        val prob = FloatArray(width * height) { idx ->
            val x = idx % width
            val y = idx / width
            val inLeft = x in 10..60 && y in 10..40
            val inRight = x in 120..170 && y in 10..40
            if (inLeft || inRight) 0.9f else 0.05f
        }
        val detections = DbPostProcess.detect(prob, width, height, width, height)
        assertEquals(2, detections.size)
        // Reading order: both at the same height here, so just check both
        // rectangles are represented, left one first in this synthetic case
        // (there is no ordering guarantee once two boxes share a top edge --
        // only "top to bottom" is promised).
        val centers = detections.map { (it.quad.topLeft.x + it.quad.bottomRight.x) / 2 }.sorted()
        assertTrue(centers[0] < 100)
        assertTrue(centers[1] > 100)
    }

    @Test
    fun `a blob below box_thresh is dropped`() {
        val width = 100
        val height = 60
        // Below DbPostProcess.Params().boxThresh (0.4) everywhere in the blob.
        val prob = uniformMap(width, height, 0.05f, intArrayOf(20, 20, 70, 40)).map { 0.3f }.toFloatArray()
        val detections = DbPostProcess.detect(prob, width, height, width, height)
        assertTrue(detections.isEmpty())
    }

    @Test
    fun `a blob below thresh never becomes a component at all`() {
        val width = 100
        val height = 60
        val prob = FloatArray(width * height) { 0.15f } // below thresh=0.2 everywhere
        val detections = DbPostProcess.detect(prob, width, height, width, height)
        assertTrue(detections.isEmpty())
    }

    @Test
    fun `coordinates scale correctly when dest differs from bitmap`() {
        // bitmap is a 2x downscaled copy of dest -- exactly the det-resize
        // relationship in the real pipeline (bitmapWidth/Height is the
        // network's own resized input; destWidth/Height is the frame the
        // caller wants quads reported in).
        val bitmapW = 100; val bitmapH = 60
        val destW = 200; val destH = 120
        val prob = uniformMap(bitmapW, bitmapH, 0.05f, intArrayOf(20, 20, 70, 40))
        val detections = DbPostProcess.detect(prob, bitmapW, bitmapH, destW, destH)
        assertEquals(1, detections.size)
        val box = detections[0].quad
        // Same raw box as the first test, but every coordinate doubled.
        assertEquals(20.0, box.topLeft.x, 3.0)
        assertEquals(20.0, box.topLeft.y, 3.0)
        assertEquals(160.0, box.bottomRight.x, 3.0)
        assertEquals(100.0, box.bottomRight.y, 3.0)
    }
}
