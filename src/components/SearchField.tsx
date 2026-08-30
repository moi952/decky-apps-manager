import React from "react";
import { FieldTextInput } from "@moi952/decky-ui-kit";

interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  size?: "small" | "medium" | "large";
  highlightOnFocus?: boolean;
  bottomSeparator?: boolean;
  placeholder?: string;
  iconEnd?: React.ReactNode;
}

// Deliberately NOT wrapped in PanelSectionCustom: that component always
// forces its own 16px left/right padding regardless of the style prop
// passed to it, and both HomeView and AllAppsView already sit inside
// their own padded container — nesting a second one doubled the side
// padding and made this field visibly narrower than everything else
// on the page (e.g. UpdateAllBar, which isn't double-wrapped).
export const SearchField: React.FC<SearchFieldProps> = ({
  value,
  onChange,
  size = "medium",
  highlightOnFocus = true,
  bottomSeparator = true,
  placeholder,
  iconEnd,
}) => (
  <div style={{ width: "100%", boxSizing: "border-box" }}>
    <FieldTextInput
      placeholder={placeholder}
      iconEnd={iconEnd}
      value={value}
      onChange={onChange}
      size={size}
      highlightOnFocus={highlightOnFocus}
      bottomSeparator={bottomSeparator}
    />
  </div>
);
