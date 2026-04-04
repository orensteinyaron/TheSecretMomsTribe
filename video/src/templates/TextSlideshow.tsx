import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Sequence,
  Easing,
  Img,
  staticFile,
  Audio,
} from "remotion";

// ---- Helpers ----

function resolveUrl(url?: string): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("http") || url.startsWith("data:")) return url;
  return staticFile(url);
}

// ---- Brand ----

const BRAND = {
  deepPurple: "#63246a",
  mauvePink: "#b74780",
  black: "#000000",
  lightGray: "#efedea",
  offWhite: "#fcfcfa",
};

const PILLAR_COLORS: Record<string, { bg: string; accent: string; warm: string }> = {
  parenting_insights: { bg: BRAND.deepPurple, accent: BRAND.mauvePink, warm: "#8b3a6b" },
  ai_magic: { bg: "#1a1a2e", accent: BRAND.mauvePink, warm: "#2a1a3e" },
  mom_health: { bg: BRAND.deepPurple, accent: "#e8a0bf", warm: "#7a3a6b" },
  default: { bg: BRAND.deepPurple, accent: BRAND.mauvePink, warm: "#8b3a6b" },
};

// ---- Interfaces ----

interface SlideData {
  text: string;
  emphasis: string;
  subtext: string;
  imageUrl?: string;
  illustration?: "heart" | "child" | "brain" | "words" | "grow" | "community";
}

interface SlideTiming {
  durationFrames: number;
  textDelay: number;
  emphasisDelay: number;
  subtextDelay: number;
}

interface TextSlideshowProps {
  hook: string;
  slides: SlideData[];
  cta: string;
  pillar: string;
  slideDurations?: number[];
  hookImageUrl?: string;
  audioUrl?: string;        // single continuous voiceover (Fix 7)
  hookDuration?: number;    // frames
  ctaDuration?: number;     // frames
  crossfade?: number;       // overlap frames (Fix 9)
}

// ---- Timing ----

function wordCount(s: string): number {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}

export function calculateSlideTiming(slide: SlideData, fps: number = 30): SlideTiming {
  const blocks = [slide.text, slide.emphasis, slide.subtext].filter(Boolean);
  const blockCount = blocks.length;
  const totalWords = blocks.reduce((sum, b) => sum + wordCount(b), 0);
  const readTimeSec = Math.max(2, totalWords / 3);
  const revealGapsSec = Math.max(0, blockCount - 1) * 1.5;

  const textReadSec = slide.text ? Math.max(0.8, wordCount(slide.text) / 3) : 0;
  const emphasisReadSec = slide.emphasis ? Math.max(0.8, wordCount(slide.emphasis) / 3) : 0;
  const subtextReadSec = slide.subtext ? Math.max(0.8, wordCount(slide.subtext) / 3) : 0;

  const textDelay = Math.round(0.4 * fps);
  const emphasisDelay = slide.emphasis ? Math.round((0.4 + textReadSec + 1.5) * fps) : textDelay;
  const subtextDelay = slide.subtext ? Math.round((0.4 + textReadSec + 1.5 + emphasisReadSec + 1.5) * fps) : emphasisDelay;

  const lastBlockDelaySec = subtextDelay / fps;
  const lastBlockReadSec = slide.subtext ? subtextReadSec : (slide.emphasis ? emphasisReadSec : textReadSec);
  const minimumSec = lastBlockDelaySec + lastBlockReadSec + 3.0 + 1.0;
  const readingMinSec = revealGapsSec + readTimeSec + 3.0 + 1.0;
  const clampedSec = Math.min(16, Math.max(5, Math.max(minimumSec, readingMinSec)));

  return { durationFrames: Math.round(clampedSec * fps), textDelay, emphasisDelay, subtextDelay };
}

export function calculateAllDurations(slides: SlideData[], fps: number = 30): number[] {
  return slides.map(s => calculateSlideTiming(s, fps).durationFrames);
}

// ---- SVG Illustrations (unchanged) ----

const IllustrationHeart: React.FC<{ frame: number; color: string }> = ({ frame, color }) => {
  const breathe = 1 + Math.sin(frame * 0.025) * 0.04;
  const opacity = interpolate(frame, [0, 40], [0, 0.18], { extrapolateRight: "clamp" });
  return (
    <svg viewBox="0 0 400 400" style={{ position: "absolute", bottom: 300, right: 40, width: 380, height: 380, opacity, transform: `scale(${breathe})` }}>
      <defs><filter id="glow-h"><feGaussianBlur stdDeviation="12" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>
      <path d="M200 340 C200 340 40 240 40 150 C40 80 100 40 150 40 C175 40 200 60 200 90 C200 60 225 40 250 40 C300 40 360 80 360 150 C360 240 200 340 200 340Z" fill="none" stroke={color} strokeWidth="2.5" filter="url(#glow-h)" />
      <path d="M200 300 C180 260 100 220 100 170 C100 130 130 100 160 100" fill="none" stroke={color} strokeWidth="1" opacity="0.5" strokeDasharray="8,12" strokeDashoffset={frame * 0.3} />
      <path d="M200 300 C220 260 300 220 300 170 C300 130 270 100 240 100" fill="none" stroke={color} strokeWidth="1" opacity="0.5" strokeDasharray="8,12" strokeDashoffset={frame * 0.3} />
    </svg>
  );
};

const IllustrationChild: React.FC<{ frame: number; color: string }> = ({ frame, color }) => {
  const sway = Math.sin(frame * 0.02) * 3;
  const opacity = interpolate(frame, [0, 40], [0, 0.2], { extrapolateRight: "clamp" });
  return (
    <svg viewBox="0 0 300 500" style={{ position: "absolute", bottom: 250, right: 60, width: 260, height: 420, opacity, transform: `translateX(${sway}px)` }}>
      <defs><filter id="glow-c"><feGaussianBlur stdDeviation="8" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>
      <circle cx="150" cy="80" r="40" fill="none" stroke={color} strokeWidth="2" filter="url(#glow-c)" />
      <path d="M150 120 C150 120 120 200 110 280 C105 320 130 380 150 400 C170 380 195 320 190 280 C180 200 150 120 150 120Z" fill="none" stroke={color} strokeWidth="2" filter="url(#glow-c)" />
      <path d="M125 180 C100 150 70 140 55 155" fill="none" stroke={color} strokeWidth="1.5" opacity="0.6" />
      <path d="M175 180 C200 150 230 140 245 155" fill="none" stroke={color} strokeWidth="1.5" opacity="0.6" />
      {[0, 1, 2, 3, 4].map(i => { const y = 60 - ((frame * 0.4 + i * 50) % 200); const x = 150 + Math.sin(i * 2.5 + frame * 0.02) * 40; const o = interpolate(y, [-40, 0, 60], [0, 0.5, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }); return <circle key={i} cx={x} cy={y} r={4 + i * 2} fill={color} opacity={o * 0.6} />; })}
    </svg>
  );
};

const IllustrationBrain: React.FC<{ frame: number; color: string }> = ({ frame, color }) => {
  const opacity = interpolate(frame, [0, 40], [0, 0.16], { extrapolateRight: "clamp" });
  const pulse = 1 + Math.sin(frame * 0.03) * 0.03;
  return (
    <svg viewBox="0 0 400 350" style={{ position: "absolute", bottom: 320, right: 30, width: 360, height: 310, opacity, transform: `scale(${pulse})` }}>
      <defs><filter id="glow-b"><feGaussianBlur stdDeviation="10" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>
      <path d="M150 60 C80 60 30 110 40 170 C50 230 100 270 150 280 C150 280 120 240 120 200 C120 140 150 100 150 60Z" fill="none" stroke={color} strokeWidth="2" filter="url(#glow-b)" />
      <path d="M250 60 C320 60 370 110 360 170 C350 230 300 270 250 280 C250 280 280 240 280 200 C280 140 250 100 250 60Z" fill="none" stroke={color} strokeWidth="2" filter="url(#glow-b)" />
      <path d="M150 170 Q200 140 250 170" fill="none" stroke={color} strokeWidth="1.5" opacity="0.5" strokeDasharray="5,8" strokeDashoffset={frame * -0.2} />
      <circle cx="200" cy="70" r="35" fill="none" stroke={color} strokeWidth="1" opacity={0.15 + Math.sin(frame * 0.05) * 0.1} strokeDasharray="3,6" />
      <text x="200" y="75" textAnchor="middle" fontSize="11" fill={color} opacity="0.4" fontFamily="sans-serif">still building</text>
    </svg>
  );
};

const IllustrationWords: React.FC<{ frame: number; color: string }> = ({ frame, color }) => {
  const opacity = interpolate(frame, [0, 40], [0, 0.18], { extrapolateRight: "clamp" });
  const words = ["unfair", "sad", "big", "broken", "scared", "mad", "hurt", "why"];
  return (
    <svg viewBox="0 0 380 500" style={{ position: "absolute", bottom: 260, right: 30, width: 340, height: 440, opacity }}>
      <defs><filter id="glow-w"><feGaussianBlur stdDeviation="6" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>
      <path d="M60 100 Q60 40 150 40 L250 40 Q340 40 340 100 L340 250 Q340 310 250 310 L180 310 L130 370 L150 310 L100 310 Q60 310 60 250Z" fill="none" stroke={color} strokeWidth="2" filter="url(#glow-w)" />
      {words.map((w, i) => { const bx = 100 + (i % 3) * 80; const by = 100 + Math.floor(i / 3) * 70; return <text key={i} x={bx + Math.sin(frame * 0.015 + i * 1.5) * 10} y={by + Math.cos(frame * 0.012 + i * 2) * 8} fontSize={14 + (i % 3) * 4} fill={color} opacity={0.2 + Math.sin(frame * 0.02 + i * 0.8) * 0.15} fontFamily="Georgia, serif" fontStyle="italic">{w}</text>; })}
    </svg>
  );
};

const IllustrationGrow: React.FC<{ frame: number; color: string }> = ({ frame, color }) => {
  const opacity = interpolate(frame, [0, 40], [0, 0.2], { extrapolateRight: "clamp" });
  const gp = interpolate(frame, [0, 180], [0, 1], { extrapolateRight: "clamp" });
  return (
    <svg viewBox="0 0 300 500" style={{ position: "absolute", bottom: 250, right: 70, width: 250, height: 420, opacity }}>
      <defs><filter id="glow-g"><feGaussianBlur stdDeviation="8" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>
      <path d={`M150 450 Q150 ${450 - gp * 300} 150 ${450 - gp * 350}`} fill="none" stroke={color} strokeWidth="2.5" filter="url(#glow-g)" strokeLinecap="round" />
      {[0.3, 0.5, 0.7].map((th, i) => { const lo = interpolate(gp, [th, th + 0.15], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }); const sy = 450 - th * 350; const side = i % 2 === 0 ? -1 : 1; return <path key={i} d={`M150 ${sy} Q${150 + side * 60} ${sy - 30 + Math.sin(frame * 0.02 + i) * 3} ${150 + side * 40} ${sy - 50}`} fill="none" stroke={color} strokeWidth="1.5" opacity={lo * 0.7} strokeLinecap="round" />; })}
      {gp > 0.8 && <circle cx="150" cy={450 - gp * 350} r={interpolate(gp, [0.8, 1], [0, 25], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} fill="none" stroke={color} strokeWidth="2" opacity={interpolate(gp, [0.8, 1], [0, 0.6], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} filter="url(#glow-g)" />}
      <circle cx="130" cy="470" r="14" fill="none" stroke={color} strokeWidth="1.5" opacity="0.4" />
      <circle cx="170" cy="465" r="10" fill="none" stroke={color} strokeWidth="1.5" opacity="0.4" />
    </svg>
  );
};

const SlideIllustration: React.FC<{ type?: string; frame: number; color: string }> = ({ type, frame, color }) => {
  switch (type) { case "heart": return <IllustrationHeart frame={frame} color={color} />; case "child": return <IllustrationChild frame={frame} color={color} />; case "brain": return <IllustrationBrain frame={frame} color={color} />; case "words": return <IllustrationWords frame={frame} color={color} />; case "grow": return <IllustrationGrow frame={frame} color={color} />; default: return null; }
};

// ---- Background (Fix 2: full-frame images) ----

const WarmBackground: React.FC<{
  colors: { bg: string; accent: string; warm: string };
  frame: number; seed: number; imageUrl?: string;
}> = ({ colors, frame, seed, imageUrl }) => {
  const scale = interpolate(frame, [0, 400], [1.0, 1.05], { extrapolateRight: "clamp" });
  const tx = interpolate(frame, [0, 400], [0, -8], { extrapolateRight: "clamp" });
  const ty = interpolate(frame, [0, 400], [0, -5], { extrapolateRight: "clamp" });

  const rand = (i: number) => { const x = Math.sin(seed * 100 + i * 9301 + 49297) * 49297; return x - Math.floor(x); };
  const hasImage = imageUrl && resolveUrl(imageUrl);

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {/* Base gradient (hidden when image present) */}
      {!hasImage && (
        <div style={{
          position: "absolute", inset: 0,
          background: `linear-gradient(${155 + seed * 8}deg, ${colors.bg} 0%, ${colors.warm} 55%, ${colors.bg}ee 100%)`,
          transform: `scale(${scale}) translate(${tx}px, ${ty}px)`,
        }} />
      )}

      {/* Full-bleed DALL-E image (Fix 2) */}
      {hasImage && (
        <Img
          src={resolveUrl(imageUrl)!}
          style={{
            position: "absolute", inset: 0,
            width: "100%", height: "100%", objectFit: "cover",
            opacity: 1.0,
            transform: `scale(${scale}) translate(${tx}px, ${ty}px)`,
          }}
        />
      )}

      {/* Subtle edge vignette (only with image) */}
      {hasImage && (
        <div style={{
          position: "absolute", inset: 0,
          background: `radial-gradient(ellipse at center, transparent 55%, ${colors.bg}55 100%)`,
        }} />
      )}

      {/* Bokeh orbs (gradient fallback only) */}
      {!hasImage && Array.from({ length: 8 }, (_, i) => {
        const cx = rand(i * 3) * 1080; const cy = rand(i * 3 + 1) * 1920;
        const r = 50 + rand(i * 3 + 2) * 140;
        const drift = Math.sin(frame * (0.3 + rand(i * 7)) * 0.012) * 18;
        const driftY = Math.cos(frame * (0.3 + rand(i * 7)) * 0.009) * 12;
        const opacity = 0.05 + rand(i * 5) * 0.1;
        const col = i % 2 === 0 ? colors.accent : colors.warm;
        return <div key={i} style={{ position: "absolute", left: cx + drift, top: cy + driftY, width: r * 2, height: r * 2, borderRadius: "50%", background: `radial-gradient(circle, ${col}${Math.round(opacity * 255).toString(16).padStart(2, "0")} 0%, transparent 70%)`, filter: `blur(${r * 0.3}px)`, pointerEvents: "none" }} />;
      })}

      {!hasImage && <div style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse at center, transparent 30%, ${colors.bg}aa 100%)` }} />}
    </AbsoluteFill>
  );
};

// ---- Frosted Panel (text area overlay on images) ----

const FrostedPanel: React.FC<{
  hasImage: boolean;
  children: React.ReactNode;
}> = ({ hasImage, children }) => {
  if (!hasImage) {
    return <AbsoluteFill style={{ justifyContent: "center", padding: "160px 70px" }}>{children}</AbsoluteFill>;
  }
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", padding: "0 30px 100px" }}>
      <div style={{
        background: "rgba(99, 36, 106, 0.75)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderRadius: 16,
        padding: 40,
      }}>
        {children}
      </div>
    </AbsoluteFill>
  );
};

// ---- Text Animation ----

const RevealText: React.FC<{ children: React.ReactNode; frame: number; fps: number; delay: number }> = ({ children, frame, fps, delay }) => {
  const progress = spring({ frame: Math.max(0, frame - delay), fps, config: { damping: 24, stiffness: 38, mass: 1.3 } });
  return <div style={{ opacity: progress, transform: `translateY(${interpolate(progress, [0, 1], [40, 0])}px)` }}>{children}</div>;
};

// ---- Emphasis text shadow (Fix 4) ----

const EMPHASIS_SHADOW = "0 0 12px rgba(255,255,255,0.25), 0 2px 6px rgba(0,0,0,0.6)";

// ---- Slides ----

const HookSlide: React.FC<{
  text: string;
  colors: { bg: string; accent: string; warm: string };
  imageUrl?: string;
}> = ({ text, colors, imageUrl }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const fadeOut = interpolate(frame, [durationInFrames - 9, durationInFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ opacity: fadeOut }}>
      <WarmBackground colors={colors} frame={frame} seed={0} imageUrl={imageUrl} />
      <IllustrationHeart frame={frame} color={colors.accent} />

      <FrostedPanel hasImage={!!imageUrl}>
        <RevealText frame={frame} fps={fps} delay={6}>
          <div style={{ fontFamily: "sans-serif", fontSize: 28, fontWeight: 800, letterSpacing: 8, color: colors.accent, textTransform: "uppercase", marginBottom: 30, opacity: 0.7 }}>smt</div>
        </RevealText>
        <RevealText frame={frame} fps={fps} delay={10}>
          <div style={{ width: 90, height: 4, backgroundColor: colors.accent, borderRadius: 2, marginBottom: 40, opacity: 0.6 }} />
        </RevealText>
        <RevealText frame={frame} fps={fps} delay={16}>
          <div style={{
            fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 60, fontWeight: 400,
            color: BRAND.offWhite, lineHeight: 1.35, fontStyle: "italic",
            textShadow: EMPHASIS_SHADOW,
          }}>{text}</div>
        </RevealText>
      </FrostedPanel>
    </AbsoluteFill>
  );
};

const ContentSlide: React.FC<{
  slide: SlideData;
  colors: { bg: string; accent: string; warm: string };
  slideIndex: number;
  timing?: SlideTiming;
  crossfade: number;
}> = ({ slide, colors, slideIndex, timing, crossfade }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const t = timing || calculateSlideTiming(slide, fps);
  const cf = crossfade || 9;

  // Fix 9: crossfade transitions
  const fadeIn = interpolate(frame, [0, cf], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const fadeOut = interpolate(frame, [durationInFrames - cf, durationInFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ opacity: fadeIn * fadeOut }}>
      <WarmBackground colors={colors} frame={frame} seed={slideIndex + 1} imageUrl={slide.imageUrl} />
      <SlideIllustration type={slide.illustration} frame={frame} color={colors.accent} />

      <div style={{ position: "absolute", top: 140, right: 70, fontFamily: "Georgia, serif", fontSize: 120, fontWeight: 300, color: colors.accent, opacity: 0.06, fontStyle: "italic", zIndex: 1 }}>{slideIndex + 1}</div>

      <FrostedPanel hasImage={!!slide.imageUrl}>
        {slide.text && (
          <RevealText frame={frame} fps={fps} delay={t.textDelay}>
            <div style={{ fontFamily: "sans-serif", fontSize: 44, fontWeight: 300, color: BRAND.offWhite, lineHeight: 1.55, marginBottom: 30 }}>{slide.text}</div>
          </RevealText>
        )}
        {slide.emphasis && (
          <RevealText frame={frame} fps={fps} delay={t.emphasisDelay}>
            <div style={{
              fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 54, fontWeight: 700,
              color: colors.accent, lineHeight: 1.3, fontStyle: "italic", marginBottom: 24,
              textShadow: EMPHASIS_SHADOW, // Fix 4
            }}>{slide.emphasis}</div>
          </RevealText>
        )}
        {slide.subtext && (
          <RevealText frame={frame} fps={fps} delay={t.subtextDelay}>
            <div style={{ fontFamily: "sans-serif", fontSize: 40, fontWeight: 300, color: BRAND.offWhite, lineHeight: 1.5, opacity: 0.85 }}>{slide.subtext}</div>
          </RevealText>
        )}
        <div style={{ marginTop: 20 }}>
          <RevealText frame={frame} fps={fps} delay={18}>
            <div style={{ width: 55, height: 3, backgroundColor: colors.accent, opacity: 0.4, borderRadius: 2 }} />
          </RevealText>
        </div>
      </FrostedPanel>
    </AbsoluteFill>
  );
};

const CTASlide: React.FC<{
  text: string;
  colors: { bg: string; accent: string; warm: string };
  crossfade: number;
}> = ({ text, colors, crossfade }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cf = crossfade || 9;
  const fadeIn = interpolate(frame, [0, cf], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const pulse = interpolate(frame % 50, [0, 25, 50], [1, 1.05, 1]);

  return (
    <AbsoluteFill style={{ opacity: fadeIn }}>
      <WarmBackground colors={colors} frame={frame} seed={99} />
      <IllustrationHeart frame={frame} color={colors.accent} />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: "120px 75px" }}>
        <RevealText frame={frame} fps={fps} delay={8}>
          <div style={{
            fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 56, fontWeight: 400,
            color: BRAND.offWhite, lineHeight: 1.4, textAlign: "center", fontStyle: "italic", marginBottom: 100,
            textShadow: EMPHASIS_SHADOW,
          }}>{text}</div>
        </RevealText>
        <RevealText frame={frame} fps={fps} delay={30}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 30, transform: `scale(${pulse})` }}>
            <div style={{ fontFamily: "sans-serif", fontSize: 30, fontWeight: 700, color: colors.accent, letterSpacing: 3 }}>@thesecretmomstribe</div>
            <div style={{ padding: "18px 60px", borderRadius: 35, border: `3px solid ${colors.accent}`, fontFamily: "sans-serif", fontSize: 24, fontWeight: 700, color: BRAND.offWhite, letterSpacing: 3, textTransform: "uppercase" }}>Follow</div>
          </div>
        </RevealText>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---- Main ----

export const TextSlideshow: React.FC<TextSlideshowProps> = ({
  hook, slides, cta, pillar, slideDurations, hookImageUrl, audioUrl,
  hookDuration: hookDur, ctaDuration: ctaDur, crossfade: cf,
}) => {
  const colors = PILLAR_COLORS[pillar] || PILLAR_COLORS.default;
  const HOOK = hookDur || 150;
  const CTA = ctaDur || 120;
  const XFADE = cf || 9;

  const durations = slideDurations && slideDurations.length === slides.length
    ? slideDurations : calculateAllDurations(slides);
  const timings = slides.map(s => calculateSlideTiming(s));

  // Calculate start frames with crossfade overlap (Fix 9)
  const slideStarts: number[] = [];
  let cursor = HOOK - XFADE; // first slide starts XFADE before hook ends
  for (let i = 0; i < durations.length; i++) {
    slideStarts.push(cursor);
    cursor += durations[i] - XFADE;
  }
  const ctaStart = cursor;

  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg }}>
      {/* Hook: 5s, no voiceover (Fix 6) */}
      <Sequence from={0} durationInFrames={HOOK}>
        <HookSlide text={hook} colors={colors} imageUrl={hookImageUrl} />
      </Sequence>

      {/* Content slides with crossfade */}
      {slides.map((slide, i) => (
        <Sequence key={i} from={slideStarts[i]} durationInFrames={durations[i]}>
          <ContentSlide slide={slide} colors={colors} slideIndex={i} timing={timings[i]} crossfade={XFADE} />
        </Sequence>
      ))}

      {/* CTA */}
      <Sequence from={ctaStart} durationInFrames={CTA}>
        <CTASlide text={cta} colors={colors} crossfade={XFADE} />
      </Sequence>

      {/* Single continuous voiceover starting at slide 1 (Fix 7) */}
      {audioUrl && resolveUrl(audioUrl) && (
        <Sequence from={slideStarts[0] || HOOK}>
          <Audio src={resolveUrl(audioUrl)!} />
        </Sequence>
      )}

      {/* Persistent watermark (Fix 5) */}
      <div style={{
        position: "absolute", bottom: 40, right: 40, zIndex: 100,
        fontFamily: "sans-serif", fontSize: 14, color: "white", opacity: 0.3,
      }}>
        @thesecretmomstribe
      </div>
    </AbsoluteFill>
  );
};
