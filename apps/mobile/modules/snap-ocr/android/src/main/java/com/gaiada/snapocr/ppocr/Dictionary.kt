package com.gaiada.snapocr.ppocr

/**
 * The CTC vocabulary: `["blank", ...character lines..., " "]`.
 *
 * Ported from `BaseRecLabelDecode.__init__` + `CTCLabelDecode.add_special_char`
 * (Apache-2.0, `ppocr/postprocess/rec_postprocess.py`): one line per
 * character in `character_dict_path`, `"blank"` prepended (index 0, matching
 * training), a literal space appended because
 * `configs/rec/PP-OCRv6/PP-OCRv6_tiny_rec.yml` sets `use_space_char: true`.
 *
 * `ppocrv6_tiny_dict.txt` (6904 lines, Apache-2.0, PaddlePaddle/PaddleOCR) is
 * bundled as a plain UTF-8 text ASSET, not a model weight: it is a character
 * table, a few KB, and ships regardless of whether the PP-OCR *models* are
 * ever downloaded, the same way a font's glyph list is not itself a font
 * binary. The two ONNX weight files are the thing this ticket keeps out of
 * the APK — see `PpocrConfig.kt`.
 *
 * `1 (blank) + 6904 (dict lines) + 1 (space) = 6906`, which matches the
 * published `PP-OCRv6_tiny_rec_onnx` graph's output width exactly (verified
 * by inspecting the ONNX graph directly on 2026-09-18) — the vocabulary size
 * is not a guess.
 */
object Dictionary {
    const val BLANK = "blank"
    const val EXPECTED_SIZE = 6906

    /**
     * Pure: parse already-loaded dictionary text into the ordered vocabulary.
     *
     * Splits on '\n' and strips a trailing '\r' per line, matching Python's
     * `readlines()` + `strip("\n").strip("\r\n")`. Only a SINGLE trailing
     * empty element (the artefact of a file ending in a newline, which
     * Kotlin's `split` produces and Python's `readlines()` does not) is
     * dropped — a blank line anywhere else in the dictionary is kept
     * verbatim, because this file's job is describing the vocabulary that
     * was actually trained, not tidying it.
     */
    fun parse(dictText: String): List<String> {
        var lines = dictText.split('\n').map { it.trimEnd('\r') }
        if (lines.isNotEmpty() && lines.last().isEmpty()) lines = lines.dropLast(1)
        return listOf(BLANK) + lines + listOf(" ")
    }
}
