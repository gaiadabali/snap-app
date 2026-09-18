package com.gaiada.snapocr.ppocr

import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.sin

/**
 * Pure geometry for DB (differentiable-binarization) post-processing —
 * docs/ON-DEVICE.md §2.4, OD-14.
 *
 * DELIBERATELY NO `android.*` IMPORT IN THIS FILE. `DbPostProcess.kt` and this
 * file are the part of OD-14 with no camera, no bitmap and no device
 * dependency — a rotated point cloud in, a quadrilateral out — which means
 * they are the part a JVM unit test can check without an emulator or a
 * handset. Everything that DOES need Android (`Bitmap`, `Canvas`, EXIF) lives
 * in `PpocrTensors.kt` instead, and is exactly the part this module cannot
 * verify without a device — kept as small and as close to the already-proven
 * `SnapOcrModule.kt` pattern as possible for that reason.
 *
 * Every algorithm here is a port of `ppocr/postprocess/db_postprocess.py`
 * (Apache-2.0, PaddlePaddle/PaddleOCR), read from the upstream source on
 * 2026-09-18, not reconstructed from memory — see the reference notes in
 * `docs/ON-DEVICE.md` OD-14 follow-up and `PpocrConfig.kt`. A Python port of
 * this exact pipeline (det → DB post-process → crop-warp → rec → CTC decode)
 * was run against `apps/server/bench/receipt.png` and `receipt-hard.png`
 * during development and correctly read the supplier, ABN, date, TOTAL and
 * GST lines on both — the numeric pipeline is verified; the Kotlin/JS ports
 * below are NOT, for want of a handset (OD-14's own constraint).
 */

data class Point(val x: Double, val y: Double)

/** Ordered `[topLeft, topRight, bottomRight, bottomLeft]`. */
data class Quad(val points: List<Point>) {
    init { require(points.size == 4) { "a Quad is exactly 4 points" } }
    val topLeft get() = points[0]
    val topRight get() = points[1]
    val bottomRight get() = points[2]
    val bottomLeft get() = points[3]
}

/** A candidate rotated rectangle before ordering: 4 corners plus its shorter side. */
data class MiniBox(val corners: List<Point>, val shortSide: Double)

object Geometry {

    /**
     * Convex hull, Andrew's monotone chain. O(n log n).
     *
     * A DB connected component is a filled blob: the hull of every member
     * pixel equals the hull of just its boundary, so callers may pass every
     * pixel in the component rather than tracing a contour first — the
     * reason this module has no separate "contour tracing" step the way
     * `cv2.findContours` does. `DbPostProcess` relies on that equivalence.
     */
    fun convexHull(pts: List<Point>): List<Point> {
        val points = pts.distinct().sortedWith(compareBy({ it.x }, { it.y }))
        if (points.size < 3) return points

        fun cross(o: Point, a: Point, b: Point): Double =
            (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

        val lower = ArrayList<Point>()
        for (p in points) {
            while (lower.size >= 2 && cross(lower[lower.size - 2], lower[lower.size - 1], p) <= 0) {
                lower.removeAt(lower.size - 1)
            }
            lower.add(p)
        }
        val upper = ArrayList<Point>()
        for (p in points.asReversed()) {
            while (upper.size >= 2 && cross(upper[upper.size - 2], upper[upper.size - 1], p) <= 0) {
                upper.removeAt(upper.size - 1)
            }
            upper.add(p)
        }
        lower.removeAt(lower.size - 1)
        upper.removeAt(upper.size - 1)
        return lower + upper
    }

    /**
     * Minimum-area enclosing rectangle, by rotating calipers over the convex
     * hull — the Kotlin/JVM equivalent of `cv2.minAreaRect`. Returns the 4
     * corners UNORDERED (in hull-edge order) plus the rectangle's shorter
     * side, matching what `cv2.minAreaRect` + `cv2.boxPoints` hand to
     * `get_mini_boxes` before ITS OWN reordering — done here by [orderQuad].
     *
     * Degenerates to the axis-aligned bounding box when fewer than 3 distinct
     * points are given (a single detected pixel, or a perfectly straight
     * line of them) — `cv2.minAreaRect` accepts these too.
     */
    fun minAreaRect(points: List<Point>): MiniBox {
        val hull = convexHull(points)
        if (hull.size < 3) {
            val xs = points.map { it.x }
            val ys = points.map { it.y }
            val minX = xs.min(); val maxX = xs.max()
            val minY = ys.min(); val maxY = ys.max()
            val corners = listOf(
                Point(minX, minY), Point(maxX, minY), Point(maxX, maxY), Point(minX, maxY),
            )
            return MiniBox(corners, minOf(maxX - minX, maxY - minY))
        }

        var best: MiniBox? = null
        var bestArea = Double.MAX_VALUE
        val n = hull.size
        for (i in 0 until n) {
            val a = hull[i]
            val b = hull[(i + 1) % n]
            val edgeLen = hypot(b.x - a.x, b.y - a.y)
            if (edgeLen < 1e-9) continue
            val dx = (b.x - a.x) / edgeLen
            val dy = (b.y - a.y) / edgeLen
            // Perpendicular (normal) direction.
            val nx = -dy
            val ny = dx

            var minD = Double.MAX_VALUE; var maxD = -Double.MAX_VALUE
            var minN = Double.MAX_VALUE; var maxN = -Double.MAX_VALUE
            for (p in hull) {
                val d = (p.x - a.x) * dx + (p.y - a.y) * dy
                val nn = (p.x - a.x) * nx + (p.y - a.y) * ny
                if (d < minD) minD = d
                if (d > maxD) maxD = d
                if (nn < minN) minN = nn
                if (nn > maxN) maxN = nn
            }
            val width = maxD - minD
            val height = maxN - minN
            val area = width * height
            if (area < bestArea) {
                bestArea = area
                val corners = listOf(
                    Point(a.x + minD * dx + minN * nx, a.y + minD * dy + minN * ny),
                    Point(a.x + maxD * dx + minN * nx, a.y + maxD * dy + minN * ny),
                    Point(a.x + maxD * dx + maxN * nx, a.y + maxD * dy + maxN * ny),
                    Point(a.x + minD * dx + maxN * nx, a.y + minD * dy + maxN * ny),
                )
                best = MiniBox(corners, minOf(width, height))
            }
        }
        return best ?: MiniBox(hull.take(4).let { if (it.size == 4) it else List(4) { hull[0] } }, 0.0)
    }

    /**
     * Reorders 4 corners to `[topLeft, topRight, bottomRight, bottomLeft]`,
     * an exact port of `db_postprocess.py`'s `get_mini_boxes`: sort by x, the
     * lower-y of the left pair is top-left, the lower-y of the right pair is
     * top-right. Ported rather than "sort by angle from centroid" because
     * that is what the reference numeric pipeline was verified against.
     */
    fun orderQuad(corners: List<Point>): Quad {
        require(corners.size == 4)
        val byX = corners.sortedBy { it.x }
        val (topLeft, bottomLeft) = if (byX[1].y > byX[0].y) byX[0] to byX[1] else byX[1] to byX[0]
        val (topRight, bottomRight) = if (byX[3].y > byX[2].y) byX[2] to byX[3] else byX[3] to byX[2]
        return Quad(listOf(topLeft, topRight, bottomRight, bottomLeft))
    }

    /** Convenience: minAreaRect + orderQuad, mirroring `get_mini_boxes` end to end. */
    fun miniQuad(points: List<Point>): Pair<Quad, Double> {
        val box = minAreaRect(points)
        return orderQuad(box.corners) to box.shortSide
    }

    /**
     * Expands a convex quadrilateral outward by `distance`, perpendicular to
     * each edge, then re-intersects consecutive offset edges — a MITER-join
     * polygon offset.
     *
     * `db_postprocess.py`'s `unclip` uses `pyclipper`'s ROUND join instead.
     * The two differ only in how sharp the OUTPUT corners are; the caller
     * (`DbPostProcess.expand`) immediately re-fits a `minAreaRect` on the
     * result, exactly as the Python reference does, which erases that
     * difference — a rounded corner and a mitred one both re-collapse to the
     * same rectangle once re-fit. Verified against the Python reference
     * (`pyclipper`) on rectangular inputs during development; see
     * `GeometryTest.unclip growsARectangleBy2xDistanceOnEachSide`.
     */
    fun unclip(quad: List<Point>, distance: Double): List<Point> {
        val n = quad.size
        // Outward normal for each edge, assuming the polygon is wound
        // CLOCKWISE in IMAGE coordinates (y grows downward) — true for
        // `orderQuad`'s [tl, tr, br, bl] winding.
        data class Edge(val a: Point, val b: Point, val nx: Double, val ny: Double)
        val edges = (0 until n).map { i ->
            val a = quad[i]; val b = quad[(i + 1) % n]
            val dx = b.x - a.x; val dy = b.y - a.y
            val len = hypot(dx, dy).coerceAtLeast(1e-9)
            // Rotate the edge direction by -90 degrees for a clockwise-wound
            // polygon's OUTWARD normal.
            Edge(a, b, dy / len, -dx / len)
        }

        fun intersect(e1: Edge, e2: Edge): Point {
            // Both edges offset outward by `distance` along their own normal.
            val a1x = e1.a.x + e1.nx * distance; val a1y = e1.a.y + e1.ny * distance
            val b1x = e1.b.x + e1.nx * distance; val b1y = e1.b.y + e1.ny * distance
            val a2x = e2.a.x + e2.nx * distance; val a2y = e2.a.y + e2.ny * distance
            val b2x = e2.b.x + e2.nx * distance; val b2y = e2.b.y + e2.ny * distance

            val d1x = b1x - a1x; val d1y = b1y - a1y
            val d2x = b2x - a2x; val d2y = b2y - a2y
            val denom = d1x * d2y - d1y * d2x
            if (abs(denom) < 1e-9) return Point(a2x, a2y) // parallel edges: offset point is exact
            val t = ((a2x - a1x) * d2y - (a2y - a1y) * d2x) / denom
            return Point(a1x + t * d1x, a1y + t * d1y)
        }

        return (0 until n).map { i ->
            val prev = edges[(i - 1 + n) % n]
            val curr = edges[i]
            intersect(prev, curr)
        }
    }

    /** Shoelace polygon area (unsigned) — used only by [DbPostProcess]'s unclip distance. */
    fun polygonArea(pts: List<Point>): Double {
        var sum = 0.0
        for (i in pts.indices) {
            val a = pts[i]; val b = pts[(i + 1) % pts.size]
            sum += a.x * b.y - b.x * a.y
        }
        return abs(sum) / 2.0
    }

    /** Polygon perimeter. */
    fun polygonPerimeter(pts: List<Point>): Double {
        var sum = 0.0
        for (i in pts.indices) {
            val a = pts[i]; val b = pts[(i + 1) % pts.size]
            sum += hypot(b.x - a.x, b.y - a.y)
        }
        return sum
    }

    /** Angle of the top edge (`topLeft` → `topRight`), radians, for diagnostics only. */
    fun topEdgeAngle(quad: Quad): Double =
        atan2(quad.topRight.y - quad.topLeft.y, quad.topRight.x - quad.topLeft.x)
}
