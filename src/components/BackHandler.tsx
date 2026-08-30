import React from "react";
import { Focusable, type GamepadEvent } from "@decky/ui";

interface BackHandlerProps {
  onBack?: () => void;
  children: React.ReactNode;
}

// A B/Escape press bubbles through every ancestor Focusable's own
// onCancelButton, not just the nearest one — fine as long as only one
// BackHandler is ever mounted at a time, which used to be true (index.tsx
// keeps exactly one "screen" mounted at once), but stops being true the
// moment a view nests its own BackHandler-wrapped sub-page inside
// another already-BackHandler-wrapped screen (e.g. AppImageSearchView's
// own catalog detail page, itself inside index.tsx's own top-level
// BackHandler) — a single press then fired the nearest one's onBack AND
// bubbled straight past it into the outer one's too, popping two levels
// (or more) at once instead of just one. Stopping it here means only the
// nearest BackHandler ever reacts to a given press.
//
// Only when onBack is actually given, though — index.tsx's own home
// screen wraps itself in a `<BackHandler>` with no onBack at all, on
// purpose: B there is meant to fall through to Decky Loader's own
// default "close the panel" handling, not be consumed here for nothing.
// Unconditionally stopping propagation regardless of onBack (the first
// version of this fix) silently swallowed that press instead, breaking
// B on the plugin's own home page entirely.
export const BackHandler: React.FC<BackHandlerProps> = ({
  onBack,
  children,
}) => (
  <Focusable
    onCancelButton={
      onBack &&
      ((evt: GamepadEvent) => {
        evt.stopPropagation();
        onBack();
      })
    }
  >
    {children}
  </Focusable>
);
