// ============================================================================
// File: src/components/ui/page-container.tsx
// Version: 1.0-page-container-ts
// Purpose: Standardized page shell for product/entity pages.
// ============================================================================

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import AppBackdrop, {
  type AppBackdropVariant,
} from "@/components/ui/app-backdrop";

export type PageContainerMaxWidth =
  | "2xl"
  | "3xl"
  | "4xl"
  | "5xl"
  | "6xl"
  | "7xl";

export type PageContainerProps = Readonly<{
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  variant?: AppBackdropVariant;
  backdrop?: boolean;
  backdropOpacity?: number;
  above?: ReactNode;
  below?: ReactNode;
  maxWidth?: PageContainerMaxWidth;
}>;

function maxWidthClass(maxWidth: PageContainerMaxWidth): string {
  switch (maxWidth) {
    case "2xl":
      return "max-w-2xl";
    case "3xl":
      return "max-w-3xl";
    case "4xl":
      return "max-w-4xl";
    case "5xl":
      return "max-w-5xl";
    case "6xl":
      return "max-w-6xl";
    case "7xl":
      return "max-w-7xl";
    default: {
      const exhaustive: never = maxWidth;
      return exhaustive;
    }
  }
}

export default function PageContainer({
  children,
  className,
  contentClassName,
  variant = "aurora",
  backdrop = true,
  backdropOpacity = 0.35,
  above,
  below,
  maxWidth = "7xl",
}: PageContainerProps) {
  return (
    <>
      {backdrop ? (
        <AppBackdrop variant={variant} opacity={backdropOpacity} />
      ) : null}

      <div
        className={cn(
          "mx-auto px-4 py-8 md:px-8",
          maxWidthClass(maxWidth),
          className,
        )}
      >
        {above ? <div className="mb-6">{above}</div> : null}

        <div className={cn("space-y-6", contentClassName)}>{children}</div>

        {below ? <div className="mt-6">{below}</div> : null}
      </div>
    </>
  );
}