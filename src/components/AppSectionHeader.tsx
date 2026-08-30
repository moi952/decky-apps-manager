import React from "react";
import { DialogButton } from "@decky/ui";
import { FiChevronDown, FiChevronRight } from "react-icons/fi";

export const APP_SECTION_HEADER_STYLES = `
  .dau-section-header {
    border-radius: var(--round-radius-size, 0px);
  }
  .dau-section-header:focus, .dau-section-header:hover {
    outline: 2px solid #dcdedf !important;
    outline-offset: 0px !important;
    background: #2a3a4a !important;
  }
  .dau-section-header:focus .dau-section-title, .dau-section-header:hover .dau-section-title {
    color: #aaa !important;
  }
  .dau-section-header:focus .dau-section-count, .dau-section-header:hover .dau-section-count {
    color: #666 !important;
  }
`;

interface AppSectionHeaderProps {
  title: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}

export const AppSectionHeader: React.FC<AppSectionHeaderProps> = ({
  title,
  count,
  collapsed,
  onToggle,
}) => (
  <DialogButton
    className="dau-section-header"
    onClick={onToggle}
    style={{
      width: "100%",
      boxSizing: "border-box",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "6px 10px",
      marginBottom: "4px",
      background: "transparent",
      border: "none",
    }}
  >
    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span
        className="dau-section-title"
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "#aaa",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {title}
      </span>
      <span className="dau-section-count" style={{ fontSize: 11, color: "#666" }}>
        {count}
      </span>
    </span>
    {collapsed ? (
      <FiChevronRight size={12} color="#888" />
    ) : (
      <FiChevronDown size={12} color="#888" />
    )}
  </DialogButton>
);
