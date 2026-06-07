// ============================================================================
// File: src/components/ui/glass-card.tsx
// Version: 1.1.0-glass-card-token-aligned-ts
// Purpose: Canonical glass card used across marketing + entity pages.
// ============================================================================

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";

export type GlassCardTone = "glass" | "subtle" | "deep";

export type GlassCardProps = React.HTMLAttributes<HTMLDivElement> & {
  hover?: boolean;
  lift?: boolean;
  tone?: GlassCardTone;
  asChild?: boolean;
};

export default function GlassCard({
  children,
  className,
  hover = false,
  lift = false,
  tone = "glass",
  asChild = false,
  ...props
}: GlassCardProps) {
  const Comp = asChild ? Slot : "div";

  const toneCls =
    tone === "deep"
      ? "bg-black/35 border-border/80"
      : tone === "subtle"
        ? "bg-card/35 border-border/60"
        : "bg-card/50 border-border/60";

  const hoverCls = hover
    ? cn(
        "transition-[border-color,background-color,box-shadow,transform] duration-200",
        "hover:border-border/90 hover:bg-card/55",
        "hover:shadow-[0_22px_70px_rgba(0,0,0,0.45)]",
        lift ? "hover:-translate-y-[1px]" : "",
      )
    : "";

  return (
    <Comp
      className={cn(
        "rounded-2xl border backdrop-blur-xl",
        "shadow-[0_18px_55px_rgba(0,0,0,0.40)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
        toneCls,
        hoverCls,
        className,
      )}
      {...props}
    >
      {children}
    </Comp>
  );
}