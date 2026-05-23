# face-metrics

Python sidecar that produces per-frame eye-line and face-center
measurements for the Avatar Full v5 transitions manifest.

Consumed by [video/lib/face-metrics.ts](../../video/lib/face-metrics.ts),
which spawns this process and pipes frame requests through stdin/stdout.

## What it does

For each input frame, returns the y-coordinate of the eye-line (midpoint
of the two iris centers) and the x-coordinate of the face center
(midpoint of the bounding box of all 478 face-mesh landmarks).

Backend: [MediaPipe FaceLandmarker](https://developers.google.com/mediapipe/solutions/vision/face_landmarker).

## One-minute bootstrap

```bash
cd bin/face-metrics

# 1. Create venv (uses Python pinned in .python-version → 3.14).
python3 -m venv .venv

# 2. Install pinned deps.
.venv/bin/pip install -r requirements.txt

# 3. Smoke test against any image with a face. The first run downloads
#    the face_landmarker.task model (~4 MB) into ./models/ and caches it.
echo '{"id":"smoke","path":"<absolute-path-to-a-face-image.png>"}' | .venv/bin/python3 main.py
```

Expected smoke output (two JSON lines on stdout):

```json
{"id":"__ready__"}
{"id":"smoke","eye_y":<int>,"face_x":<int>,"face_w":<int>,"face_h":<int>,"img_w":<int>,"img_h":<int>}
```

If no face is detected:

```json
{"id":"smoke","error":"no_face_detected"}
```

## Why a sidecar (not Node-native)

MediaPipe's most precise face mesh ships only as Python wheels — the
JS port (`@mediapipe/face_mesh`) is the legacy 468-point model and is
no longer maintained. The TypeScript wrapper crosses the boundary once
per render and amortizes the spawn cost across all frames.

## Protocol

Each input line is a JSON object on stdin:

```json
{"id": "<frame-id>", "path": "<absolute path to PNG/JPG frame>"}
```

Each output line is a JSON object on stdout. On success:

```json
{
  "id": "<frame-id>",
  "eye_y": <int>, "face_x": <int>,
  "face_w": <int>, "face_h": <int>,
  "img_w": <int>, "img_h": <int>
}
```

On failure (the daemon never crashes on a single bad frame):

```json
{"id": "<frame-id>", "error": "no_face_detected" | "image_unreadable" | "<other>"}
```

The first line emitted is always `{"id":"__ready__"}` once the model
has loaded — the TS wrapper waits for this before sending requests.

## Files

| Path | Purpose |
|---|---|
| `main.py` | Sidecar entrypoint |
| `requirements.txt` | Pinned deps (`mediapipe==0.10.35`, `opencv-python-headless==4.13.0.92`) |
| `.python-version` | Python 3.14 pin |
| `.venv/` | **Gitignored.** Created by bootstrap step 1. |
| `models/face_landmarker.task` | **Gitignored.** Downloaded on first run. |
