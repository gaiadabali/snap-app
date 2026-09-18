package com.gaiada.snapocr.ppocr

import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * DB (differentiable binarization) post-processing — the probability map the
 * detection model emits, turned into text-line quadrilaterals in ORIGINAL
 * page pixels.
 *
 * A direct port of `ppocr/postprocess/db_postprocess.py`'s `boxes_from_bitmap`
 * (Apache-2.0, PaddlePaddle/PaddleOCR, `box_type='quad'`), read from upstream
 * on 2026-09-18 — not reconstructed from memory, and cross-checked by running
 * the equivalent Python (numpy + opencv + pyclipper) against
 * `apps/server/bench/receipt.png` and `receipt-hard.png` during development.
 * That Python run correctly recovered the supplier name, ABN, invoice date,
 * "TAX INVOICE", TOTAL and GST lines on both images — the algorithm below is
 * that same sequence of steps, translated line for line. What it CANNOT
 * inherit from that run is proof that ONNX Runtime Android's own execution
 * path, this Kotlin port's per-pixel loops, and the crop/warp in
 * `PpocrTensors.kt` agree with it bit-for-bit on a real phone. Only a device
 * closes that gap (OD-14's own "the ticket is closed with the measured
 * reason" clause).
 *
 * Differences from the Python reference, each deliberate:
 *   - Connected components replace `cv2.findContours`: a DB probability map's
 *     foreground blobs have no holes worth tracing, so the convex hull of a
 *     component's member pixels is the same shape `cv2.findContours` would
 *     trace the boundary of (see `Geometry.convexHull`'s note).
 *   - `Geometry.unclip` is a miter-join offset, not `pyclipper`'s round join
 *     (see its own doc comment for why the difference is erased by the
 *     re-fit that follows it, exactly as upstream re-fits).
 */
object DbPostProcess {

    data class Detection(val quad: Quad, val score: Double)

    data class Params(
        /** `configs/det/PP-OCRv6/PP-OCRv6_tiny_det.yml` PostProcess.thresh. */
        val thresh: Double = 0.2,
        /** ...PostProcess.box_thresh. */
        val boxThresh: Double = 0.4,
        /** ...PostProcess.unclip_ratio. */
        val unclipRatio: Double = 1.4,
        /** `db_postprocess.py DBPostProcess.min_size` (not configurable upstream). */
        val minSize: Double = 3.0,
        /** `db_postprocess.py DBPostProcess.max_candidates` default retained. */
        val maxCandidates: Int = 3000,
    )

    /**
     * @param prob        row-major probability map, length `bitmapWidth * bitmapHeight`.
     * @param bitmapWidth width of the map (and of the image actually fed to the network).
     * @param bitmapHeight height of the map.
     * @param destWidth   width of the space the returned quads should be reported in
     *                    (the ORIGINAL page, or whatever frame the caller scaled the
     *                    bitmap from — `docdom.ts` rule 1 wants original page pixels).
     * @param destHeight  height of that space.
     */
    fun detect(
        prob: FloatArray,
        bitmapWidth: Int,
        bitmapHeight: Int,
        destWidth: Int,
        destHeight: Int,
        params: Params = Params(),
    ): List<Detection> {
        require(prob.size == bitmapWidth * bitmapHeight) {
            "prob map size ${prob.size} does not match ${bitmapWidth}x$bitmapHeight"
        }
        val binary = BooleanArray(prob.size) { prob[it] > params.thresh }
        val components = connectedComponents(binary, bitmapWidth, bitmapHeight, params.maxCandidates)

        val out = ArrayList<Detection>()
        for (member in components) {
            val points = member.map { idx -> Point((idx % bitmapWidth).toDouble(), (idx / bitmapWidth).toDouble()) }
            val (quad1, shortSide1) = Geometry.miniQuad(points)
            if (shortSide1 < params.minSize) continue

            val score = boxScore(prob, bitmapWidth, bitmapHeight, quad1.points)
            if (score < params.boxThresh) continue

            val area = Geometry.polygonArea(quad1.points)
            val perimeter = Geometry.polygonPerimeter(quad1.points)
            if (perimeter < 1e-6) continue
            val distance = area * params.unclipRatio / perimeter
            val expanded = Geometry.unclip(quad1.points, distance)

            val (quad2, shortSide2) = Geometry.miniQuad(expanded)
            if (shortSide2 < params.minSize + 2) continue

            val mapped = quad2.points.map { p ->
                Point(
                    (p.x / bitmapWidth * destWidth).roundToInt().toDouble().coerceIn(0.0, destWidth.toDouble()),
                    (p.y / bitmapHeight * destHeight).roundToInt().toDouble().coerceIn(0.0, destHeight.toDouble()),
                )
            }
            out.add(Detection(Quad(mapped), score))
        }
        // Reading order: top-to-bottom by the quad's own top edge. A receipt
        // is read top to bottom; left-to-right WITHIN a line is not this
        // module's concern because — per the "textline_detection" tag on the
        // PP-OCRv6 det models — one detection already spans one printed line,
        // unlike ML Kit's word-level elements which `SnapOcrModule.assembleRows`
        // groups into rows. There is deliberately no rows-within-a-line
        // grouping step here.
        return out.sortedBy { min(it.quad.topLeft.y, it.quad.topRight.y) }
    }

    /**
     * 8-connected components over a boolean grid, iterative (no recursion —
     * a docket-sized map is hundreds of thousands of pixels and a recursive
     * flood fill would blow the stack). Returns each component as a list of
     * pixel indices (row-major).
     */
    private fun connectedComponents(
        binary: BooleanArray,
        width: Int,
        height: Int,
        maxComponents: Int,
    ): List<IntArray> {
        val visited = BooleanArray(binary.size)
        val components = ArrayList<IntArray>()
        val stack = IntArray(binary.size)

        for (start in binary.indices) {
            if (!binary[start] || visited[start]) continue
            if (components.size >= maxComponents) break

            var sp = 0
            stack[sp++] = start
            visited[start] = true
            val member = ArrayList<Int>()
            while (sp > 0) {
                val idx = stack[--sp]
                member.add(idx)
                val x = idx % width
                val y = idx / width
                for (dy in -1..1) {
                    for (dx in -1..1) {
                        if (dx == 0 && dy == 0) continue
                        val nx = x + dx
                        val ny = y + dy
                        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
                        val nIdx = ny * width + nx
                        if (binary[nIdx] && !visited[nIdx]) {
                            visited[nIdx] = true
                            stack[sp++] = nIdx
                        }
                    }
                }
            }
            components.add(member.toIntArray())
        }
        return components
    }

    /**
     * Mean probability inside the (convex) quad — `box_score_fast`'s
     * bounding-box-local mask, rasterized with an even-odd point-in-polygon
     * test rather than `cv2.fillPoly`.
     */
    private fun boxScore(prob: FloatArray, width: Int, height: Int, quad: List<Point>): Double {
        val xMin = max(0, floor(quad.minOf { it.x }).toInt())
        val xMax = min(width - 1, ceil(quad.maxOf { it.x }).toInt())
        val yMin = max(0, floor(quad.minOf { it.y }).toInt())
        val yMax = min(height - 1, ceil(quad.maxOf { it.y }).toInt())
        if (xMax < xMin || yMax < yMin) return 0.0

        var sum = 0.0
        var count = 0
        for (y in yMin..yMax) {
            for (x in xMin..xMax) {
                if (pointInPolygon(x + 0.5, y + 0.5, quad)) {
                    sum += prob[y * width + x]
                    count++
                }
            }
        }
        return if (count == 0) 0.0 else sum / count
    }

    private fun pointInPolygon(x: Double, y: Double, poly: List<Point>): Boolean {
        var inside = false
        var j = poly.size - 1
        for (i in poly.indices) {
            val pi = poly[i]; val pj = poly[j]
            if ((pi.y > y) != (pj.y > y) &&
                x < (pj.x - pi.x) * (y - pi.y) / (pj.y - pi.y) + pi.x
            ) {
                inside = !inside
            }
            j = i
        }
        return inside
    }
}
