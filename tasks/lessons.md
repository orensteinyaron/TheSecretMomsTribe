# SMT Lessons Learned

Updated automatically after corrections and performance reviews.
Mirrored to Supabase `lessons` table.

---

## 2026-06-10 — Avatar v5 audio "chopped word" at clip stitches (debugging discipline)

1. **Measure audio, never guess.** A "voice hiccup / chopped word" at cuts 2→3
   and 5→6 took several wrong fixes (disabled bridges, re-rolled clips) before I
   decoded the render to PCM and measured the max sample-to-sample delta at each
   cut. The flagged cuts spiked to **0.025 / 0.098** vs **~0.0003** at clean
   cuts — instantly localizing it. Tools that actually answer audio questions:
   `ffmpeg` → PCM + a tiny Node delta scan; Whisper word-timestamps (showed
   *phonemes* were complete, so it was the word's **tail/decay** being cut, not a
   missing phoneme); waveform/spectrogram PNGs (Read them) for shape.

2. **An artifact at a STITCH is a composition bug, not a content bug.** I wasted
   ~162 cr re-rolling clip_02/clip_05 chasing a "rushed word." The real cause was
   the compose layer. Re-rolling also drifted Rachel's framing (YAR-137) → 2×
   normalize zoom → worse. Reverting the re-rolls + fixing the code was correct.

3. **Root cause:** the v5 "audio bridge" was a 4-frame Sequence overlap with **no
   volume envelope** — the comment claimed the audio "ramps in / tails out" but no
   ramp existed. Hard cut = bare splice → sample-step click; bridge = full-gain
   overlap → outgoing word tail slammed by incoming onset. Fix = the equal-power
   cross-fade the spec always described (`AvatarV5Clip` `volume` envelope). The
   code-comment described behavior that wasn't implemented — verify claims against
   code.

4. **Every render now self-checks.** `video/lib/audio-boundary-check.ts` (unit
   tested) runs in `--phase=compose` and FAILs if any cut's sample-jump > 0.01.
   The gap was: QA measured identity (mis-calibrated) but not audio boundaries,
   hook-overlay fit, or framing consistency — so real defects shipped silently.

5. **Hook-overlay overflow regression.** `SMTHookOverlay` had a hardcoded 124 px
   font with no width cap; a 6-word hook overflowed the frame (a bug we'd hit
   before). Fixed with a length-responsive font + hard width cap. `hook_overlay_style`
   was UNMEASURED in QA — that's why it regressed.

6. **Two-backgrounds bug (YAR-153) — `normalize-clips` zoom divergence.** Three
   clips showed the right-wall frames, three showed a blank wall. Root cause:
   normalize scaled each clip *differently* to equalize **face size**; because
   Seedance renders Rachel at varying distances (YAR-137), that = different zoom
   per clip = decor cropped from the high-zoom clips (scale 1.5–1.6×) and kept in
   the low-zoom ones (1.08–1.18×). Proven by comparing **raw vs normalized**
   frames: raw clip_01 HAD the frames; normalized clip_01 (1.61× zoom) cropped
   them. Fix = **uniform scale for all clips** (background zoom identical),
   position-only eye-line alignment; face size varies by design. Gate:
   `checkBackgroundScaleUniform` aborts normalize if scale ratio > 1.02.
   **Lesson:** a per-clip transform that equalizes one property (face size) can
   silently break another (background framing) — and a pixel-histogram output
   gate is unreliable when the subject varies; assert the deterministic invariant
   (uniform scale, shared start image) instead. QA's `background_drift=none` was
   too coarse to catch decor being cropped.

7. **The residual "click" was a trailing transient, fixed by tail-trim — not the
   cross-fade (YAR-156).** After the cross-fade, one stitch still clicked. Cause:
   clip_05's raw Seedance audio had a loud isolated burst (RMS 0.28) ~0.16 s
   AFTER the last word, in the trailing silence — a mouth-click/glitch. The
   cross-fade attenuated but didn't remove it. The spec's tail-trim (Finding 9)
   was documented "mandatory" but **never implemented**; building it (silence-
   aware, `lib/tail-trim.ts`) removed the transient. **Lesson:** build the spec's
   mandatory steps before relying on them; and a cross-fade hides a step but
   can't remove a real sound in the gap — remove the sound.

8. **Cross-fade via Remotion `volume` callback CLICKS; bake `afade` instead.** A
   per-frame `volume` envelope is piecewise-constant per frame, so a fast fade
   steps at each frame boundary → a click per step. Sample-accurate ffmpeg
   `afade` baked into the clip in `normalize-clips` is smooth; `OffthreadVideo`
   stays a pure passthrough (Finding 4).

9. **A QA-gate metric must distinguish the defect from normal content.** First
   audio gate (raw single-sample jump) false-positived on speech slope once
   clips were tail-trimmed close to the word (a 0.1-amplitude tone steps
   ~0.02/sample). Fix: count a jump only where LOCAL energy is low (a click in a
   quiet gap), not during speech. Same theme as the background gate: gate on the
   invariant / context, never on a raw signal that also varies in clean output.

10. **Meta (the most expensive lesson): measure before fixing A/V artifacts.**
    Decode to PCM (sample-jump / RMS), Whisper word-timestamps, waveform &
    spectrogram PNGs, raw-vs-normalized frame compares. Several wrong fixes
    (disabled bridges, re-rolled clips — which also broke framing) and wasted
    Higgsfield credits preceded the first real measurement, which found each root
    cause in one shot. A stitch defect is a COMPOSITION bug — never re-roll
    content to fix it. Every defect found now leaves an automated gate behind.

---

## 2026-04-02 — Project Bootstrap

1. **Meme/relatable content outperforms educational 25:1.**
   Never lead with information. Always lead with emotion.

2. **Cross-posting IG to TikTok does not work.**
   Each platform needs native content optimized for its algorithm.

3. **Educational series format fails at small scale.**
   Don't do multi-part series until audience is established.

4. **Accounts dormant since mid-2024 need reactivation.**
   Consistent daily posting required to rebuild algorithm trust.

5. **Apify MCP server PATH issues on macOS.**
   Use full paths (`/usr/local/bin/npx`) and set PATH in env
   when configuring MCP servers that spawn child processes.
