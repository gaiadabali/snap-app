package com.gaiada.snapocr.ppocr

import org.junit.Assert.assertEquals
import org.junit.Test

class CtcDecodeTest {

    private val vocab = listOf("blank", "A", "B", "C", " ")

    /** One row per timestep, `bestIndex` gets `confidence`, everything else 0. */
    private fun logitsFor(perTimestep: List<Pair<Int, Float>>): FloatArray {
        val vocabSize = vocab.size
        val out = FloatArray(perTimestep.size * vocabSize)
        perTimestep.forEachIndexed { t, (idx, conf) ->
            out[t * vocabSize + idx] = conf
        }
        return out
    }

    @Test
    fun `collapses repeats and drops blank`() {
        // A A blank B B B blank -> "AB"
        val sequence = listOf(1 to 0.9f, 1 to 0.8f, 0 to 0.99f, 2 to 0.7f, 2 to 0.6f, 2 to 0.95f, 0 to 0.99f)
        val logits = logitsFor(sequence)
        val result = CtcDecode.decode(logits, sequence.size, vocab.size, vocab)
        assertEquals("AB", result.text)
        // Confidence is the mean of the KEPT timesteps' own scores: the first
        // A (0.9) and the first B (0.7).
        assertEquals(0.8f, result.confidence, 1e-4f)
    }

    @Test
    fun `a blank between two identical letters keeps both`() {
        // A blank A -> "AA", not "A" -- collapsing must not cross a blank.
        val sequence = listOf(1 to 0.9f, 0 to 0.99f, 1 to 0.85f)
        val logits = logitsFor(sequence)
        val result = CtcDecode.decode(logits, sequence.size, vocab.size, vocab)
        assertEquals("AA", result.text)
    }

    @Test
    fun `all-blank input decodes to empty text with zero confidence`() {
        val sequence = listOf(0 to 0.99f, 0 to 0.99f, 0 to 0.99f)
        val logits = logitsFor(sequence)
        val result = CtcDecode.decode(logits, sequence.size, vocab.size, vocab)
        assertEquals("", result.text)
        assertEquals(0f, result.confidence, 1e-6f)
    }

    @Test
    fun `space is a real character, not a separator to be dropped`() {
        // A space B -> "A B"
        val sequence = listOf(1 to 0.9f, 4 to 0.9f, 2 to 0.9f)
        val logits = logitsFor(sequence)
        val result = CtcDecode.decode(logits, sequence.size, vocab.size, vocab)
        assertEquals("A B", result.text)
    }
}
