import React from "react";
import { ThemedSurface } from "@moi952/decky-ui-kit";

// Thin, indeterminate progress bar shown while a silent background
// refresh is running (the panel already has cached data to show, so a
// full-screen spinner would be overkill — this just says "still
// checking" without blocking anything underneath it).
export const TopProgressBar: React.FC = () => (
  <ThemedSurface
    style={{
      width: "100%",
      height: 2,
      overflow: "hidden",
    }}
  >
    <style>{`
      @keyframes dau-progress-slide {
        0% { transform: translateX(-100%); }
        100% { transform: translateX(350%); }
      }
    `}</style>
    <div
      style={{
        height: "100%",
        width: "30%",
        background: "#4caf50",
        animation: "dau-progress-slide 1.1s ease-in-out infinite",
      }}
    />
  </ThemedSurface>
);
