package com.gaiada.snapocr.ppocr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.cos
import kotlin.math.sin

/**
 * JVM-only tests for the part of OD-14 with no camera and no device: a
 * rotated point cloud in, a quadrilateral out. See `Geometry.kt`'s own doc
 * comment for why this file exists and what it deliberately does NOT prove.
 */
class GeometryTest {

    @Test
    fun `minAreaRect on an axis-aligned rectangle recovers its own corners`() {
        // A filled 10x4 rectangle's member pixels, not just its 4 corners --
        // exercising the "hull of every pixel" assumption DbPostProcess relies on.
        val points = ArrayList<Point>()
        for (x in 0..9) for (y in 0..3) points.add(Point(x.toDouble(), y.toDouble()))

        val (quad, shortSide) = Geometry.miniQuad(points)
        assertEquals(3.0, shortSide, 0.5)
        assertEquals(0.0, quad.topLeft.x, 0.5)
        assertEquals(0.0, quad.topLeft.y, 0.5)
        assertEquals(9.0, quad.topRight.x, 0.5)
        assertEquals(0.0, quad.topRight.y, 0.5)
        assertEquals(9.0, quad.bottomRight.x, 0.5)
        assertEquals(3.0, quad.bottomRight.y, 0.5)
        assertEquals(0.0, quad.bottomLeft.x, 0.5)
        assertEquals(3.0, quad.bottomLeft.y, 0.5)
    }

    @Test
    fun `minAreaRect on a rotated rectangle finds the rotated box, not its axis-aligned bounds`() {
        // A true 20x6 rectangle rotated 30 degrees about the origin. Its
        // axis-aligned bounding box would be much bigger than 20x6; a real
        // minAreaRect must not fall back to that.
        val angle = Math.toRadians(30.0)
        val corners = listOf(
            Point(0.0, 0.0), Point(20.0, 0.0), Point(20.0, 6.0), Point(0.0, 6.0),
        ).map { rotate(it, angle) }

        // Sample points along the perimeter (a hollow outline, like a
        // detector's contour would provide) rather than every interior pixel.
        val perimeter = ArrayList<Point>()
        for (i in 0..100) {
            val t = i / 100.0
            perimeter.add(lerp(corners[0], corners[1], t))
            perimeter.add(lerp(corners[1], corners[2], t))
            perimeter.add(lerp(corners[2], corners[3], t))
            perimeter.add(lerp(corners[3], corners[0], t))
        }

        val box = Geometry.minAreaRect(perimeter)
        val area = box.corners.let { pts ->
            // Shoelace, to sanity-check total area independent of orientation.
            Geometry.polygonArea(pts)
        }
        assertEquals(120.0, area, 2.0) // 20 x 6, allowing for point-sampling slack
        assertEquals(6.0, box.shortSide, 0.5)
    }

    @Test
    fun `orderQuad returns topLeft, topRight, bottomRight, bottomLeft`() {
        val unordered = listOf(Point(10.0, 10.0), Point(0.0, 0.0), Point(10.0, 0.0), Point(0.0, 10.0))
        val quad = Geometry.orderQuad(unordered)
        assertEquals(Point(0.0, 0.0), quad.topLeft)
        assertEquals(Point(10.0, 0.0), quad.topRight)
        assertEquals(Point(10.0, 10.0), quad.bottomRight)
        assertEquals(Point(0.0, 10.0), quad.bottomLeft)
    }

    @Test
    fun `unclip grows an axis-aligned rectangle by 2x distance on each side`() {
        val box = listOf(Point(0.0, 0.0), Point(10.0, 0.0), Point(10.0, 4.0), Point(0.0, 4.0))
        val expanded = Geometry.unclip(box, 2.0)
        // Re-fit exactly as DbPostProcess does, so this test checks the same
        // thing the pipeline actually consumes.
        val (quad, _) = Geometry.miniQuad(expanded)
        assertEquals(-2.0, quad.topLeft.x, 1e-6)
        assertEquals(-2.0, quad.topLeft.y, 1e-6)
        assertEquals(12.0, quad.bottomRight.x, 1e-6)
        assertEquals(6.0, quad.bottomRight.y, 1e-6)
    }

    @Test
    fun `unclip on a rotated rectangle preserves its angle`() {
        val angle = Math.toRadians(15.0)
        val box = listOf(Point(0.0, 0.0), Point(20.0, 0.0), Point(20.0, 4.0), Point(0.0, 4.0)).map { rotate(it, angle) }
        val expanded = Geometry.unclip(box, 1.0)
        val (quad, _) = Geometry.miniQuad(expanded)
        val expandedAngle = Geometry.topEdgeAngle(quad)
        assertEquals(angle, expandedAngle, 0.05)
        // Area should grow by roughly perimeter*distance + 4*distance^2
        // (the standard Minkowski-sum-with-a-square estimate).
        val originalArea = Geometry.polygonArea(box)
        val newArea = Geometry.polygonArea(quad.points)
        val expectedGrowth = Geometry.polygonPerimeter(box) * 1.0 + 4 * 1.0 * 1.0
        assertEquals(originalArea + expectedGrowth, newArea, 3.0)
    }

    @Test
    fun `convexHull drops interior points`() {
        val points = listOf(
            Point(0.0, 0.0), Point(4.0, 0.0), Point(4.0, 4.0), Point(0.0, 4.0),
            Point(2.0, 2.0), // interior — must not survive
        )
        val hull = Geometry.convexHull(points)
        assertEquals(4, hull.size)
        assertTrue(hull.none { it == Point(2.0, 2.0) })
    }

    private fun rotate(p: Point, angle: Double): Point =
        Point(p.x * cos(angle) - p.y * sin(angle), p.x * sin(angle) + p.y * cos(angle))

    private fun lerp(a: Point, b: Point, t: Double): Point =
        Point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
}
