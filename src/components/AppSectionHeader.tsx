import React from "react";
import { CollapsibleSection } from "@moi952/decky-ui-kit";

interface AppSectionHeaderProps {
  title: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}

// Only the header: the rows below it stay with the caller.
export const AppSectionHeader: React.FC<AppSectionHeaderProps> = ({
  title,
  count,
  collapsed,
  onToggle,
}) => (
  <CollapsibleSection
    variant="group-header"
    label={title}
    count={count}
    expanded={!collapsed}
    onToggle={onToggle}
  >
    {null}
  </CollapsibleSection>
);
