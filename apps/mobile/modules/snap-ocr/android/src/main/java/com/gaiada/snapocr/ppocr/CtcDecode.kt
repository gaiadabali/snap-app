package com.gaiada.snapocr.ppocr

/**
 * Greedy CTC decode for the PP-OCRv6 tiny/small recognition heads.
 *
 * A port of `ppocr/postprocess/rec_postprocess.py`'s `CTCLabelDecode.decode`
 * (Apache-2.0). The recogniser's `Architecture.Head` is a `MultiHead`
 * (CTCHead + NRTRHead trained jointly), but `PostProcess: CTCLabelDecode` in
 * `configs/rec/PP-OCRv6/PP-OCRv6_tiny_rec.yml` is what the exported inference
 * graph actually decodes with — confirmed by inspecting the published
 * `PaddlePaddle/PP-OCRv6_tiny_rec_onnx` ONNX graph directly: it has exactly
 * one output, shape `[N, T, 6906]`, and 6906 is exactly
 * `1 (blank) + 6904 (ppocrv6_tiny_dict.txt lines) + 1 (space)` — the NRTR head
 * is not present in the exported graph at all. There is no second head to
 * reconcile.
 *
 * The reference Python decode (raw `argmax`/`max` over the ONNX output, no
 * extra softmax) produced confidences in a sane 0–1 band on real receipt
 * crops (`apps/server/bench/receipt.png`), which is why this port does not
 * apply softmax either — the exported graph's output is evidently already a
 * per-timestep distribution.
 */
object CtcDecode {

    data class Result(val text: String, val confidence: Float)

    /** Index 0 in every PaddleOCR CTC vocabulary — `add_special_char` prepends it. */
    const val BLANK_INDEX = 0

    /**
     * @param logits    row-major `[timesteps, vocabSize]` — the model's raw output for one line.
     * @param vocab     `["blank", ...ppocrv6_tiny_dict.txt lines..., " "]`, length `vocabSize`.
     */
    fun decode(logits: FloatArray, timesteps: Int, vocabSize: Int, vocab: List<String>): Result {
        require(logits.size == timesteps * vocabSize) {
            "logits size ${logits.size} does not match $timesteps x $vocabSize"
        }
        require(vocab.size == vocabSize) { "vocab has ${vocab.size} entries, expected $vocabSize" }

        val text = StringBuilder()
        val keptProbs = ArrayList<Float>()
        var previous = -1

        for (t in 0 until timesteps) {
            val base = t * vocabSize
            var bestIdx = 0
            var bestVal = logits[base]
            for (v in 1 until vocabSize) {
                val value = logits[base + v]
                if (value > bestVal) {
                    bestVal = value
                    bestIdx = v
                }
            }
            // Collapse repeats (CTC's own rule), then drop blank — in that
            // order, exactly as `CTCLabelDecode.decode` does. Reversing the
            // order would merge "AA" (two genuine letters either side of a
            // blank) into "A".
            if (bestIdx != BLANK_INDEX && bestIdx != previous) {
                text.append(vocab[bestIdx])
                keptProbs.add(bestVal)
            }
            previous = bestIdx
        }

        val confidence = if (keptProbs.isEmpty()) 0f else keptProbs.average().toFloat()
        return Result(text.toString(), confidence)
    }
}
