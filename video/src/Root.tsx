import React from "react";
import { Composition, getInputProps } from "remotion";
import { TextSlideshow, calculateAllDurations } from "./templates/TextSlideshow";
import { KaraokeSlideshow } from "./templates/v2/KaraokeSlideshow";
import { SyncTest } from "./templates/SyncTest";
import { AvatarComposition } from "./templates/avatar/AvatarComposition";
import { type AvatarCompositionProps, AVATAR_FPS } from "./templates/avatar/types";
import { AvatarV5Composition, layoutClips } from "./templates/avatar-v5/AvatarV5Composition";
import {
  AVATAR_V5_FPS,
  AVATAR_V5_WIDTH,
  AVATAR_V5_HEIGHT,
  type AvatarV5Props,
} from "./templates/avatar-v5/types";

const FPS = 30;

// ---- V1 Defaults ----
const HOOK_DURATION = 150;
const CTA_DURATION = 120;
const CROSSFADE = 9;

const V1_DEFAULTS = {
  hook: "your 5-year-old isn't being dramatic. their feelings are just bigger than their words.",
  slides: [
    { text: "Here's what nobody tells you about emotional meltdowns in little kids:", emphasis: "they're not a behavior problem.", subtext: "They're a vocabulary problem.", illustration: "child" as const },
    { text: "A 5-year-old's prefrontal cortex won't be fully developed until they're 25.", emphasis: "When they lose it over the broken cracker,", subtext: "they genuinely cannot process that feeling yet.", illustration: "brain" as const },
    { text: "The fastest way to shorten a meltdown isn't correction.", emphasis: "It's naming.", subtext: "\"you wanted that cracker to stay whole and now it's broken and that feels really unfair\"", illustration: "words" as const },
    { text: "You're not indulging them.", emphasis: "You're building the emotional vocabulary", subtext: "they'll use for the rest of their life.", illustration: "grow" as const },
  ],
  cta: "Save this for the next time aisle 7 goes sideways.",
  pillar: "parenting_insights",
};

// ---- V2 Defaults (for Remotion Studio preview) ----
const V2_DEFAULTS = {
  hookText: "your 5-year-old isn't being dramatic",
  hookImage: "",
  slides: [] as any[],
  ctaText: "Follow for more",
  pillar: "parenting_insights",
  audioMode: "voice" as const,
  voiceoverFile: "",
  totalDuration: 30,
};

export const RemotionRoot: React.FC = () => {
  const inputProps = getInputProps() as Record<string, any>;

  // V1 calculations
  const v1Props = { ...V1_DEFAULTS, ...inputProps } as any;
  const slides = v1Props.slides || V1_DEFAULTS.slides;
  const slideDurations = v1Props.slideDurations || calculateAllDurations(slides, FPS);
  const totalSlideFrames = slideDurations.reduce((a: number, b: number) => a + b, 0);
  const hookDur = v1Props.hookDuration || HOOK_DURATION;
  const ctaDur = v1Props.ctaDuration || CTA_DURATION;
  const xfade = v1Props.crossfade || CROSSFADE;
  const numTransitions = slides.length + 1;
  const v1Frames = hookDur + totalSlideFrames + ctaDur - numTransitions * xfade;

  // Avatar defaults
  const AVATAR_DEFAULTS: AvatarCompositionProps = {
    clips: [],
    phraseTimings: [],
    hookText: "You NEED to know this",
    ctaText: "Follow for more",
    totalDurationSec: 30,
    pillar: "parenting_insights",
    audioFile: "",
  };

  // V2 calculations
  const v2TotalDuration = inputProps.totalDuration || V2_DEFAULTS.totalDuration;
  const v2Frames = Math.round(v2TotalDuration * FPS);
  const v2Props = inputProps.hookText ? { ...V2_DEFAULTS, ...inputProps } : V2_DEFAULTS;

  return (
    <>
      <Composition
        id="TextSlideshow"
        component={TextSlideshow as any}
        durationInFrames={v1Frames}
        fps={FPS}
        width={1080}
        height={1920}
        defaultProps={{ ...v1Props, slideDurations, hookDuration: hookDur, ctaDuration: ctaDur, crossfade: xfade }}
      />
      <Composition
        id="KaraokeSlideshow"
        component={KaraokeSlideshow as any}
        durationInFrames={v2Frames}
        fps={FPS}
        width={1080}
        height={1920}
        defaultProps={v2Props}
      />
      <Composition
        id="AvatarComposition"
        component={AvatarComposition as any}
        durationInFrames={Math.round((inputProps.totalDurationSec || AVATAR_DEFAULTS.totalDurationSec) * AVATAR_FPS)}
        fps={AVATAR_FPS}
        width={1080}
        height={1920}
        defaultProps={inputProps.clips ? { ...AVATAR_DEFAULTS, ...inputProps } : AVATAR_DEFAULTS}
      />
      <Composition
        id="SyncTest"
        component={SyncTest as any}
        durationInFrames={inputProps.totalFrames || 150}
        fps={FPS}
        width={1080}
        height={1920}
        defaultProps={{
          audioFile: "sync-test-audio.mp3",
          phrases: [],
          totalFrames: 150,
          audioDur: 5,
        }}
      />
      {(() => {
        const v5Props: AvatarV5Props = {
          clips: (inputProps.clips as AvatarV5Props["clips"]) ?? [],
          transitions: (inputProps.transitions as AvatarV5Props["transitions"]) ?? [],
          hook_text: (inputProps.hook_text as string) ?? "",
        };
        const total = Math.max(1, layoutClips(v5Props, AVATAR_V5_FPS).total_duration_in_frames);
        return (
          <Composition
            id="AvatarV5"
            component={AvatarV5Composition as any}
            durationInFrames={total}
            fps={AVATAR_V5_FPS}
            width={AVATAR_V5_WIDTH}
            height={AVATAR_V5_HEIGHT}
            defaultProps={v5Props}
          />
        );
      })()}
    </>
  );
};
