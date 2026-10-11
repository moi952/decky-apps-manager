import React from "react";
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
    <div
      style={{
        width: size ?? "100%",
        height: size ?? "100%",
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 8,
        background: "rgba(255, 255, 255, 0.08)",
        color: "#9aa1a8",
      }}
    >
      <Glyph size={size ? Math.round(size * 0.5) : 18} />
    </div>
  );
};
