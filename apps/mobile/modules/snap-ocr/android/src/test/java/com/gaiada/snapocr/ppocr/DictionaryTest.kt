package com.gaiada.snapocr.ppocr

import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

class DictionaryTest {

    @Test
    fun `blank is index 0 and space is appended last`() {
        val vocab = Dictionary.parse("!\n\"\n#\n")
        assertEquals(listOf("blank", "!", "\"", "#", " "), vocab)
    }

    @Test
    fun `a trailing newline does not create a phantom empty entry`() {
        val withTrailingNewline = Dictionary.parse("A\nB\n")
        val withoutTrailingNewline = Dictionary.parse("A\nB")
        assertEquals(withoutTrailingNewline, withTrailingNewline)
        assertEquals(listOf("blank", "A", "B", " "), withTrailingNewline)
    }

    @Test
    fun `the bundled dictionary parses to exactly the size the ONNX graph expects`() {
        // The asset lives under android/src/main/assets -- read directly
        // from disk rather than through Android's AssetManager, which is not
        // available to a plain JVM test (see PpocrModule.loadDictionary for
        // the on-device path, which reads the same file through the app's
        // assets).
        val here = File(".").canonicalFile
        val assetFile = findUp(here, "src/main/assets/ppocrv6_tiny_dict.txt")
            ?: error("could not locate src/main/assets/ppocrv6_tiny_dict.txt from $here")
        val vocab = Dictionary.parse(assetFile.readText(Charsets.UTF_8))
        assertEquals(Dictionary.EXPECTED_SIZE, vocab.size)
        assertEquals("blank", vocab.first())
        assertEquals(" ", vocab.last())
    }

    private fun findUp(start: File, relative: String): File? {
        var dir: File? = start
        var hops = 0
        while (dir != null && hops < 6) {
            val candidate = File(dir, relative)
            if (candidate.exists()) return candidate
            dir = dir.parentFile
            hops++
        }
        return null
    }
}
