import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { trimSilenceToFit } from "../audio-trim.js";

// trimSilenceToFit shells out to ffmpeg (write trimmed temp file) then
// ffprobe (re-measure). Both are INJECTED here so the test exercises the
// orchestration — filter args, file replacement, return value — without any
// real ffmpeg/ffprobe on the box.

function tmpMp3(contents = "ORIGINAL"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audio-trim-"));
  const p = path.join(dir, "clip_03.mp3");
  fs.writeFileSync(p, contents);
  return p;
}

test("trimSilenceToFit: calls ffmpeg with a silenceremove filter", () => {
  const mp3 = tmpMp3();
  let capturedFile = "";
  let capturedArgs: string[] = [];

  const spawn = (file: string, args: string[]) => {
    capturedFile = file;
    capturedArgs = args;
    // Simulate ffmpeg writing the trimmed temp output.
    const outPath = args[args.length - 1];
    fs.writeFileSync(outPath, "TRIMMED");
  };
  const measure = () => 13.4;

  trimSilenceToFit(mp3, 13.5, { spawn, measure });

  assert.equal(capturedFile, "ffmpeg");
  const filterIdx = capturedArgs.indexOf("-af");
  assert.ok(filterIdx >= 0, "ffmpeg invoked with -af filter flag");
  assert.match(capturedArgs[filterIdx + 1], /silenceremove=/);
});

test("trimSilenceToFit: replaces the original file with the trimmed output", () => {
  const mp3 = tmpMp3("ORIGINAL");

  const spawn = (_file: string, args: string[]) => {
    const outPath = args[args.length - 1];
    assert.notEqual(outPath, mp3, "ffmpeg must write to a temp path, not in place");
    fs.writeFileSync(outPath, "TRIMMED");
  };
  const measure = () => 13.4;

  trimSilenceToFit(mp3, 13.5, { spawn, measure });

  // Original path now holds the trimmed bytes; the temp file is gone (renamed).
  assert.equal(fs.readFileSync(mp3, "utf-8"), "TRIMMED");
  assert.equal(fs.existsSync(path.join(path.dirname(mp3), "clip_03.trimmed.mp3")), false);
});

test("trimSilenceToFit: returns the RE-MEASURED duration of the trimmed file", () => {
  const mp3 = tmpMp3();
  const spawn = (_file: string, args: string[]) => {
    fs.writeFileSync(args[args.length - 1], "TRIMMED");
  };
  let measuredPath = "";
  const measure = (p: string) => {
    measuredPath = p;
    return 13.37;
  };

  const result = trimSilenceToFit(mp3, 13.5, { spawn, measure });

  assert.equal(result, 13.37);
  assert.equal(measuredPath, mp3, "re-measure runs against the replaced original path");
});
