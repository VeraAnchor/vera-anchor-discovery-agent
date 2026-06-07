// ============================================================================
// File: src/components/ui/app-backdrop.tsx
// Version: 1.3-token-aligned-ts
// Purpose: Shared premium animated background for product-grade pages.
// ============================================================================

import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

export type AppBackdropVariant = "aurora" | "violet";

export type AppBackdropProps = {
  variant?: AppBackdropVariant;
  className?: string;
  opacity?: number;
};

function clamp01(x: unknown): number {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export default function AppBackdrop({
  variant = "aurora",
  className,
  opacity = 0.35,
}: AppBackdropProps) {
  const reduceMotion = useReducedMotion();
  const o = clamp01(opacity);

  const anim =
    variant === "aurora"
      ? [
          "radial-gradient(circle at 15% 85%, rgba(34, 211, 238, 0.28) 0%, transparent 55%)",
          "radial-gradient(circle at 85% 15%, rgba(168, 85, 247, 0.26) 0%, transparent 55%)",
          "radial-gradient(circle at 15% 85%, rgba(34, 211, 238, 0.28) 0%, transparent 55%)",
        ]
      : [
          "radial-gradient(circle at 20% 80%, rgba(168, 85, 247, 0.26) 0%, transparent 55%)",
          "radial-gradient(circle at 80% 20%, rgba(34, 211, 238, 0.26) 0%, transparent 55%)",
          "radial-gradient(circle at 20% 80%, rgba(168, 85, 247, 0.26) 0%, transparent 55%)",
        ];

  return (
    <div className={cn("fixed inset-0 -z-10", className)} aria-hidden="true">
      <div className="absolute inset-0 bg-background" />

      {reduceMotion ? (
        <div
          className="absolute inset-0"
          style={{ background: anim[0], opacity: o }}
        />
      ) : (
        <motion.div
          animate={{ background: anim }}
          transition={{ duration: 26, repeat: Infinity, ease: "linear" }}
          className="absolute inset-0"
          style={{ opacity: o }}
        />
      )}

      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.06),transparent_60%)] opacity-60" />
      <div className="absolute inset-0 bg-black/20" />
    </div>
  );
}