# docai-engine — the PP-OCRv5 sidecar, as a deployable service.
#
# Closes docs/CORPUS.md §7's A1′ and the real half of docs/GAPS.md A1. A1 reads
# as "run the sidecar locally once", but the larger fact was that this service
# was not in deploy/docker-compose.yml AT ALL and nothing set DOCAI_SIDECAR_URL
# — so the OCR stage has never run in production. `shadow.ts` treats an unset
# URL as "feature absent" and returns silently, which is correct behaviour and
# also why nobody noticed.
#
# Build context is THIS directory (not the repo root): nothing here needs the
# pnpm workspace. That is the seam working as intended — TypeScript owns DocDOM,
# grounding and the pipeline; this process owns only PaddleOCR's shapes.

FROM python:3.13-slim AS base

# PaddlePaddle and OpenCV need these and the error when they are missing is
# an unhelpful ImportError from deep inside a shared object:
#   libgomp1      — OpenMP runtime, paddle's threading
#   libglib2.0-0  — opencv-python
#   libgl1        — opencv-python's cv2.imshow linkage (pulled in even headless)
#   libxext6 libsm6 libxrender1 — X11 stubs opencv links against
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       libgomp1 libglib2.0-0 libgl1 libxext6 libsm6 libxrender1 curl \
  && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Requirements first, so a code change does not re-resolve ~1 GB of wheels.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY ocr_engine.py app.py ./

# ── Bake the weights in ──────────────────────────────────────────────────────
# PaddleOCR downloads its models to ~/.paddlex on first use. Left to itself a
# fresh container would fetch them on the FIRST REQUEST — a multi-second stall
# attributed to OCR latency rather than to a cold start, on a path whose whole
# purpose is measuring latency honestly. Worse, it makes the container require
# network egress to a CDN at runtime, which docs/OCR.md D17's air-gapped
# profile forbids outright.
#
# So instantiate the engine at BUILD time. This both downloads the weights and
# proves they load: a broken pin fails the image build rather than the first
# scan. Mobile tier is 4.7 MB (det) + 16 MB (rec), so this costs almost nothing
# in layer size.
#
# DOCAI_MODEL_TIER is a build arg so an image can be baked for `server` tier
# too; the runtime env var of the same name must MATCH, or the container
# downloads a second set on first use and the bake was pointless.
ARG DOCAI_MODEL_TIER=mobile
ENV DOCAI_MODEL_TIER=${DOCAI_MODEL_TIER}
RUN python -c "import ocr_engine; ocr_engine.OcrEngine(); print('models loaded and cached')"

# Non-root. The service reads an uploaded image from the request body and
# writes nothing, so it needs no write access to anything but /tmp.
RUN useradd --create-home --uid 10001 docai \
  && cp -r /root/.paddlex /home/docai/.paddlex \
  && chown -R docai:docai /home/docai /app
USER docai
ENV HOME=/home/docai

EXPOSE 8088

# Single worker on purpose. The model is loaded once per process and is several
# hundred MB resident; N uvicorn workers means N copies. Concurrency here is
# bounded by CPU anyway — a receipt takes ~5.7s on the mobile tier — so the
# right way to scale this is more containers, not more workers in one.
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8088", "--workers", "1"]

HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=5 \
  CMD curl -fsS http://127.0.0.1:8088/health | grep -q '"ok":true' || exit 1
