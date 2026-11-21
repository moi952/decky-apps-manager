import React from "react";
import { ThemedSurface } from "@moi952/decky-ui-kit";
import { FiBox, FiLayers } from "react-icons/fi";

interface AppIconProps {
  src: string | null;
  // Fills the parent (list rows size their own media slot) when omitted.
  size?: number;
  // Runtimes never ship an icon of their own.
  runtime?: boolean;
}

export const AppIcon: React.FC<AppIconProps> = ({ src, size, runtime }) => {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        style={
          size
            ? { width: size, height: size, objectFit: "contain" }
            : { maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }
        }
      />
    );
  }

  const Glyph = runtime ? FiLayers : FiBox;
  return (
    <ThemedSurface
      style={{
        width: size ?? "100%",
        height: size ?? "100%",
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 8,
      }}
    >
      {/* Colour and fill on the icon itself: a theme recolours / fills every svg of a
          focused button, which would turn this placeholder dark and solid. */}
      <Glyph
        size={size ? Math.round(size * 0.5) : 18}
        color="#9aa1a8"
        style={{ fill: "none" }}
      />
    </ThemedSurface>
  );
};
