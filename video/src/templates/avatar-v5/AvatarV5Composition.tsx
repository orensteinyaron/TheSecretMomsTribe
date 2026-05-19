import React from "react";
import { AbsoluteFill, Sequence } from "remotion";

import {
  AUDIO_BRIDGE_FRAMES,
  AVATAR_V5_FPS,
  MOTION_BLUR_FRAMES,
  type AvatarV5Props,
} from "./types";
import { AvatarV5Clip } from "./AvatarV5Clip";
import { AvatarV5Captions } from "./AvatarV5Captions";
import { SMTHookOverlay } from "../shared/SMTHookOverlay";

const HOOK_OVERLAY_DURATION_S = 1.0;

// Avatar Full v5 Remotion composition.
//
// Each clip lives in its own Sequence. The Sequences overlap by
// AUDIO_BRIDGE_FRAMES at every cut so clip N+1 starts AUDIO_BRIDGE_FRAMES
// before clip N ends. During the overlap:
//   - Clip N+1 is layered visually on top (rendered after clip N) → 4
//     frames of clip N+1 visual show before clip N's visual would have
//     ended. Functions as a tiny visible lead-in.
//   - Both OffthreadVideos play, so both audios mix briefly (~133 ms).
//     This IS the audio bridge — clip N+1's audio starts to ramp in
//     while clip N's audio tails out, all from the SAME OffthreadVideos.
//     No <Audio> re-overlay — honors YAR-129 Finding 4.
//
// Motion blur on flagged cuts: layoutMotionBlur() reads the transitions
// manifest and tags each clip with blur_in_frames (incoming side of cut)
// and blur_out_frames (outgoing side). AvatarV5Clip uses useCurrentFrame
// to apply a deterministic CSS blur ramp on those frames.
//
// Hook overlay rides on top of clip 0 only, for clip 0's full duration.

type ClipLayoutEntry = {
  clip_index: number;
  from_frame: number;
  duration_in_frames: number;
  blur_in_frames: number;
  blur_out_frames: number;
};

export function layoutClips(props: AvatarV5Props, fps: number = AVATAR_V5_FPS): {
  entries: ClipLayoutEntry[];
  total_duration_in_frames: number;
} {
  const durations = props.clips.map((c) => Math.max(1, Math.round(c.duration_s * fps)));
  const entries: ClipLayoutEntry[] = [];
  let cursor = 0;
  for (let i = 0; i < props.clips.length; i++) {
    // bridge_enabled defaults to true. transitions[i-1] describes the cut
    // BEFORE clip i (i.e. clips[i-1] → clips[i]).
    const incomingTransition = i > 0 ? props.transitions[i - 1] : undefined;
    const bridgeEnabled = incomingTransition ? (incomingTransition.bridge_enabled ?? true) : false;
    const bridgeOffset = bridgeEnabled ? AUDIO_BRIDGE_FRAMES : 0;
    const startsAt = i === 0 ? 0 : cursor - bridgeOffset;
    entries.push({
      clip_index: i,
      from_frame: Math.max(0, startsAt),
      duration_in_frames: durations[i],
      blur_in_frames: 0,
      blur_out_frames: 0,
    });
    cursor = entries[i].from_frame + durations[i];
  }
  for (let i = 0; i < props.transitions.length; i++) {
    if (!props.transitions[i].needs_motion_blur) continue;
    if (entries[i]) entries[i].blur_out_frames = MOTION_BLUR_FRAMES;
    if (entries[i + 1]) entries[i + 1].blur_in_frames = MOTION_BLUR_FRAMES;
  }
  return { entries, total_duration_in_frames: cursor };
}

export const AvatarV5Composition: React.FC<AvatarV5Props> = (props) => {
  const { entries } = layoutClips(props);
  const hookFrames = Math.round(HOOK_OVERLAY_DURATION_S * AVATAR_V5_FPS);
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {entries.map((entry) => {
        const clip = props.clips[entry.clip_index];
        return (
          <Sequence
            key={clip.id}
            from={entry.from_frame}
            durationInFrames={entry.duration_in_frames}
            layout="none"
          >
            <AvatarV5Clip
              clip={clip}
              blur_in_frames={entry.blur_in_frames}
              blur_out_frames={entry.blur_out_frames}
              duration_in_frames={entry.duration_in_frames}
            />
            {clip.phrases && clip.phrases.length > 0 ? (
              <AvatarV5Captions phrases={clip.phrases} />
            ) : null}
          </Sequence>
        );
      })}
      {props.hook_primary ? (
        // Locked SMT hook overlay: full-width #63246a block, lower-middle,
        // 1.0s hard cut in/out, all-caps. See SMTHookOverlay.tsx + FACE_OF_SMT_V1.
        <Sequence from={0} durationInFrames={hookFrames} layout="none">
          <SMTHookOverlay primary={props.hook_primary} secondary={props.hook_secondary} />
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
};
