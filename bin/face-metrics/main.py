#!/usr/bin/env python3
"""face-metrics — mediapipe FaceLandmarker sidecar for Avatar Full v5.

Reads one JSON request per line on stdin, writes one JSON response per
line on stdout. The TypeScript wrapper at video/lib/face-metrics.ts
spawns this process and pipes frame requests through it.

Request:
    {"id": "<frame-id>", "path": "<absolute path to PNG/JPG frame>"}

Response (success):
    {"id": "<id>", "eye_y": <int>, "face_x": <int>, "face_w": <int>,
     "face_h": <int>, "img_w": <int>, "img_h": <int>}

Response (failure):
    {"id": "<id>", "error": "no_face_detected" | "image_unreadable"
                          | "model_load_failed" | "<other>"}

Eye-line definition: midpoint y of the two iris-center landmarks (468
left, 473 right, refined-landmark mesh). Face-center definition:
midpoint x of the bounding box of all 478 landmarks.

The model file (face_landmarker.task, ~4MB) is downloaded once on first
run and cached at models/face_landmarker.task. Gitignored.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request

import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision

# Mediapipe refined-landmark mesh indices for iris centers.
LEFT_IRIS_CENTER = 468
RIGHT_IRIS_CENTER = 473

MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
    "face_landmarker/float16/1/face_landmarker.task"
)
MODEL_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "models", "face_landmarker.task"
)


def ensure_model() -> None:
    if os.path.exists(MODEL_PATH):
        return
    os.makedirs(os.path.dirname(MODEL_PATH), exist_ok=True)
    print(f"[face-metrics] downloading model to {MODEL_PATH}…", file=sys.stderr)
    urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
    print(f"[face-metrics] model ready ({os.path.getsize(MODEL_PATH)} bytes)", file=sys.stderr)


def make_landmarker() -> mp_vision.FaceLandmarker:
    options = mp_vision.FaceLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=MODEL_PATH),
        output_face_blendshapes=False,
        output_facial_transformation_matrixes=False,
        num_faces=1,
        running_mode=mp_vision.RunningMode.IMAGE,
    )
    return mp_vision.FaceLandmarker.create_from_options(options)


def measure(landmarker: mp_vision.FaceLandmarker, image_path: str) -> dict:
    if not os.path.exists(image_path):
        return {"error": "image_unreadable"}
    bgr = cv2.imread(image_path)
    if bgr is None:
        return {"error": "image_unreadable"}
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    height, width = rgb.shape[:2]
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    result = landmarker.detect(mp_image)
    if not result.face_landmarks:
        return {"error": "no_face_detected"}
    landmarks = result.face_landmarks[0]
    left_y = int(landmarks[LEFT_IRIS_CENTER].y * height)
    right_y = int(landmarks[RIGHT_IRIS_CENTER].y * height)
    eye_y = (left_y + right_y) // 2
    xs = [int(p.x * width) for p in landmarks]
    ys = [int(p.y * height) for p in landmarks]
    x0, x1 = min(xs), max(xs)
    y0, y1 = min(ys), max(ys)
    return {
        "eye_y": eye_y,
        "face_x": (x0 + x1) // 2,
        "face_w": x1 - x0,
        "face_h": y1 - y0,
        "img_w": width,
        "img_h": height,
    }


def main() -> int:
    try:
        ensure_model()
        landmarker = make_landmarker()
    except Exception as exc:  # noqa: BLE001 — surface ANY load failure as a fatal response
        print(json.dumps({"id": "__init__", "error": f"model_load_failed: {exc}"}), flush=True)
        return 1

    # Signal readiness so the TS wrapper knows model load is done.
    print(json.dumps({"id": "__ready__"}), flush=True)

    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError as exc:
            print(json.dumps({"id": "__parse_error__", "error": f"bad_json: {exc}"}), flush=True)
            continue
        frame_id = req.get("id", "")
        try:
            payload = measure(landmarker, req.get("path", ""))
        except Exception as exc:  # noqa: BLE001 — never crash the daemon on a single frame
            payload = {"error": f"unexpected: {exc}"}
        payload["id"] = frame_id
        print(json.dumps(payload), flush=True)

    return 0


if __name__ == "__main__":
    sys.exit(main())
