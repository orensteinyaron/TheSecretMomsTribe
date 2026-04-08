import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  Img,
  staticFile,
  OffthreadVideo,
  Sequence,
} from "remotion";
import {
  type VisualSegment,
  type MotionType,
  type SlideData,
  HOOK_FRAMES,
  BG_CROSSFADE,
  FPS,
  MOTION_TYPES,
} from "./types";

interface BackgroundSequenceProps {
  slides: SlideData[];
  totalDuration: number;
  hookImage: string;
}

const applyMotion = (
  frame: number,
  durationFrames: number,
  motionType: MotionType
): React.CSSProperties => {
  const progress = interpolate(frame, [0, durationFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  switch (motionType) {
    case "ZOOM_IN": {
      const scale = interpolate(progress, [0, 1], [1.0, 1.3]);
      return { transform: `scale(${scale})` };
    }
    case "ZOOM_OUT": {
      const scale = interpolate(progress, [0, 1], [1.3, 1.0]);
      return { transform: `scale(${scale})` };
    }
    case "PAN_LEFT": {
      const tx = interpolate(progress, [0, 1], [8, -8]);
      return { transform: `scale(1.15) translateX(${tx}%)` };
    }
    case "PAN_RIGHT": {
      const tx = interpolate(progress, [0, 1], [-8, 8]);
      return { transform: `scale(1.15) translateX(${tx}%)` };
    }
    case "PAN_UP": {
      const ty = interpolate(progress, [0, 1], [5, -5]);
      return { transform: `scale(1.15) translateY(${ty}%)` };
    }
    case "TILT": {
      const rot = interpolate(progress, [0, 1], [-2, 2]);
      const scale = interpolate(progress, [0, 1], [1.05, 1.15]);
      return { transform: `rotate(${rot}deg) scale(${scale})` };
    }
    default:
      return { transform: "scale(1.0)" };
  }
};

const HookBackground: React.FC<{ hookImage: string }> = ({ hookImage }) => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, HOOK_FRAMES], [1.0, 1.3], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill>
      <Img
        src={staticFile(hookImage)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${scale})`,
        }}
      />
    </AbsoluteFill>
  );
};

interface FlatSegment {
  type: VisualSegment["type"];
  file: string;
  startFrame: number;
  endFrame: number;
  motionType: MotionType;
  zoomLevel: number;
}

const SegmentRenderer: React.FC<{
  segment: FlatSegment;
  segmentFrame: number;
  segmentDuration: number;
}> = ({ segment, segmentFrame, segmentDuration }) => {
  if (segment.type === "black_flash") {
    return (
      <AbsoluteFill style={{ backgroundColor: "#000" }} />
    );
  }

  if (segment.type === "video") {
    return (
      <AbsoluteFill>
        <OffthreadVideo
          src={staticFile(segment.file)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      </AbsoluteFill>
    );
  }

  if (segment.type === "zoom_cut") {
    const zl = segment.zoomLevel;
    const offsetX = ((segment.startFrame * 7) % 5) - 2; // deterministic small offset
    const offsetY = ((segment.startFrame * 13) % 5) - 2;
    return (
      <AbsoluteFill>
        <Img
          src={staticFile(segment.file)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `scale(${zl}) translate(${offsetX}%, ${offsetY}%)`,
          }}
        />
      </AbsoluteFill>
    );
  }

  // photo with Ken Burns
  const motionStyle = applyMotion(segmentFrame, segmentDuration, segment.motionType);

  return (
    <AbsoluteFill>
      <Img
        src={staticFile(segment.file)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          ...motionStyle,
        }}
      />
    </AbsoluteFill>
  );
};

const SegmentWithCrossfade: React.FC<{ segment: FlatSegment; segmentDuration: number; isFirst: boolean }> = ({ segment, segmentDuration, isFirst }) => {
  const localFrame = useCurrentFrame();

  // First segment: no fade-in (appears immediately after hook)
  // All others: fade in over BG_CROSSFADE frames (crossfade with previous)
  const fadeIn = isFirst
    ? 1
    : interpolate(localFrame, [0, BG_CROSSFADE], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ opacity: fadeIn }}>
      <SegmentRenderer segment={segment} segmentFrame={localFrame} segmentDuration={segmentDuration} />
    </AbsoluteFill>
  );
};

export const BackgroundSequence: React.FC<BackgroundSequenceProps> = ({
  slides,
  totalDuration,
  hookImage,
}) => {
  const { fps } = useVideoConfig();

  // Flatten all visual segments from all slides into chronological order
  const flatSegments: FlatSegment[] = [];
  for (const slide of slides) {
    for (const seg of slide.visualSegments) {
      const motionIdx = (flatSegments.length) % MOTION_TYPES.length;
      flatSegments.push({
        type: seg.type,
        file: seg.file,
        startFrame: Math.round(seg.startTime * fps),
        endFrame: Math.round(seg.endTime * fps),
        motionType: seg.motionType || MOTION_TYPES[motionIdx],
        zoomLevel: seg.zoomLevel || 1.3,
      });
    }
  }

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {/* Hook image — first HOOK_FRAMES */}
      <Sequence from={0} durationInFrames={HOOK_FRAMES}>
        <HookBackground hookImage={hookImage} />
      </Sequence>

      {/* Visual segments — each extends by BG_CROSSFADE so outgoing stays visible during incoming fade-in */}
      {flatSegments.map((seg, i) => {
        const segDuration = seg.endFrame - seg.startFrame;
        if (segDuration <= 0) return null;

        // Extend duration so this segment stays visible while the NEXT one fades in on top
        const extendedDuration = segDuration + BG_CROSSFADE;

        return (
          <Sequence
            key={i}
            from={seg.startFrame}
            durationInFrames={extendedDuration}
          >
            <SegmentWithCrossfade segment={seg} segmentDuration={segDuration} isFirst={i === 0} />
          </Sequence>
        );
      })}

      {/* Dark overlay for text readability */}
      <AbsoluteFill
        style={{
          background: "rgba(0,0,0,0.08)",
        }}
      />

      {/* Vignette */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 60%, rgba(0,0,0,0.25) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};
