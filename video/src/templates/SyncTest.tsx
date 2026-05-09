/**
 * Minimal sync test composition.
 * Purple background + audio + phrase captions timed to Whisper timestamps.
 * No images, no effects, no distractions — just sync verification.
 */

import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  Audio,
  staticFile,
} from "remotion";

interface PhraseData {
  words: string;
  startFrame: number;
  endFrame: number;
  emphasis: boolean;
}

interface SyncTestProps {
  audioFile: string;
  phrases: PhraseData[];
  totalFrames: number;
  audioDur: number;
}

export const SyncTest: React.FC<SyncTestProps> = ({
  audioFile,
  phrases,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentSec = frame / fps;

  // Find active phrase
  const activePhrase = phrases.find(
    (p) => frame >= p.startFrame && frame < p.endFrame,
  );

  // Debug: show frame counter and current time
  const debugText = `Frame: ${frame} | Time: ${currentSec.toFixed(2)}s`;

  return (
    <AbsoluteFill style={{ backgroundColor: "#63246a" }}>
      {/* Audio starts at frame 0 */}
      <Audio src={staticFile(audioFile)} />

      {/* Debug info top-left */}
      <div
        style={{
          position: "absolute",
          top: 40,
          left: 40,
          fontFamily: "monospace",
          fontSize: 24,
          color: "rgba(255,255,255,0.5)",
        }}
      >
        {debugText}
      </div>

      {/* Active phrase — centered */}
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          padding: "0 60px",
        }}
      >
        {activePhrase ? (
          <div
            style={{
              fontFamily: "sans-serif",
              fontSize: 80,
              fontWeight: 800,
              color: "#FFFFFF",
              textTransform: "uppercase",
              textAlign: "center",
              lineHeight: 1.2,
              textShadow:
                "0 2px 8px rgba(0,0,0,0.8), 0 0 30px rgba(0,0,0,0.4)",
            }}
          >
            {activePhrase.words}
          </div>
        ) : (
          <div
            style={{
              fontFamily: "sans-serif",
              fontSize: 40,
              color: "rgba(255,255,255,0.3)",
              textAlign: "center",
            }}
          >
            (no phrase active)
          </div>
        )}
      </AbsoluteFill>

      {/* Phrase timeline at bottom */}
      <div
        style={{
          position: "absolute",
          bottom: 80,
          left: 40,
          right: 40,
          fontFamily: "monospace",
          fontSize: 16,
          color: "rgba(255,255,255,0.4)",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        {phrases.map((p, i) => {
          const isActive =
            frame >= p.startFrame && frame < p.endFrame;
          return (
            <div
              key={i}
              style={{
                color: isActive
                  ? "#b74780"
                  : "rgba(255,255,255,0.3)",
                fontWeight: isActive ? 700 : 400,
              }}
            >
              [{p.startFrame}-{p.endFrame}] {p.words}
              {isActive ? " ◄" : ""}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
