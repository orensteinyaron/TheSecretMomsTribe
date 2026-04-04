import React from "react";
import { Composition, getInputProps } from "remotion";
import { TextSlideshow, calculateAllDurations } from "./templates/TextSlideshow";

const FPS = 30;
const HOOK_DURATION = 150;  // 5s (Fix 6)
const CTA_DURATION = 120;   // 4s
const CROSSFADE = 9;         // 0.3s overlap (Fix 9)

const DEFAULT_PROPS = {
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

export const RemotionRoot: React.FC = () => {
  const inputProps = getInputProps();
  const props = { ...DEFAULT_PROPS, ...inputProps };
  const slides = props.slides || DEFAULT_PROPS.slides;

  const slideDurations = props.slideDurations || calculateAllDurations(slides, FPS);
  const totalSlideFrames = slideDurations.reduce((a: number, b: number) => a + b, 0);
  const hookDur = props.hookDuration || HOOK_DURATION;
  const ctaDur = props.ctaDuration || CTA_DURATION;
  const xfade = props.crossfade || CROSSFADE;

  // Total frames accounting for crossfade overlaps (Fix 9)
  const numTransitions = slides.length + 1; // hook→s1, between slides, lastSlide→CTA
  const totalFrames = hookDur + totalSlideFrames + ctaDur - numTransitions * xfade;

  return (
    <Composition
      id="TextSlideshow"
      component={TextSlideshow}
      durationInFrames={totalFrames}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={{ ...props, slideDurations, hookDuration: hookDur, ctaDuration: ctaDur, crossfade: xfade }}
    />
  );
};
