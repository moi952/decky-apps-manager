import React from "react";
import { FaCheckCircle, FaTimesCircle } from "react-icons/fa";

// Matches decky-ui-kit's own DEFAULT_ROUNDNESS — not importable directly,
// that's an internal (non-exported) constant there.
const ROUNDNESS = "var(--round-radius-size, 4px)";

export interface StatusCardProps {
  variant?: "success" | "error";
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  // A fork of decky-ui-kit's own StatusCard (not yet published there —
  // see the plugin's own note on why apps-manager can't depend on its
  // unreleased components) with one addition: hiding the icon entirely
  // to save vertical space when the card's own children (e.g. a list of
  // apps) already make the card's purpose obvious. Defaults to showing
  // it, matching the original component's own always-on behavior.
  hideIcon?: boolean;
  children?: React.ReactNode;
}

const VARIANT_COLORS = {
  success: {
    fg: "#5fdb6a",
    bg: "rgba(95, 219, 106, 0.12)",
    border: "rgba(95, 219, 106, 0.35)",
  },
  error: {
    fg: "#ff6b6b",
    bg: "rgba(255, 107, 107, 0.12)",
    border: "rgba(255, 107, 107, 0.35)",
  },
};

export const StatusCard: React.FC<StatusCardProps> = ({
  variant = "success",
  title,
  description,
  icon,
  hideIcon = false,
  children,
}) => {
  const colors = VARIANT_COLORS[variant];
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        padding: "18px 10px 14px",
        borderRadius: ROUNDNESS,
        background: colors.bg,
        border: `1px solid ${colors.border}`,
      }}
    >
      {!hideIcon && (
        <div style={{ fontSize: 42, color: colors.fg, marginBottom: 8 }}>
          {icon ?? (variant === "success" ? <FaCheckCircle /> : <FaTimesCircle />)}
        </div>
      )}
      <div
        style={{
          fontSize: 15,
          fontWeight: 700,
          marginBottom: description ? 4 : children ? 14 : 0,
        }}
      >
        {title}
      </div>
      {description && (
        <div style={{ fontSize: 11, opacity: 0.75, marginBottom: children ? 14 : 0 }}>
          {description}
        </div>
      )}
      {children}
    </div>
  );
};
