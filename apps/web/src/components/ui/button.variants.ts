import { cva } from "class-variance-authority";

export const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg",
    "text-sm font-semibold transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45 focus-visible:ring-offset-0",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        default:
          "border border-primary/60 bg-primary text-primary-foreground " +
          "hover:border-primary/75 hover:bg-primary/90",

        secondary:
          "border border-border/70 bg-secondary text-secondary-foreground " +
          "hover:border-border/90 hover:bg-secondary/85",

        destructive:
          "border border-destructive/65 bg-destructive text-destructive-foreground " +
          "hover:border-destructive/80 hover:bg-destructive/90",

        outline:
          "border border-border/75 bg-background/40 text-foreground backdrop-blur-sm " +
          "hover:border-border/95 hover:bg-accent/35 hover:text-accent-foreground",

        ghost:
          "border border-transparent hover:border-border/60 hover:bg-accent/35 hover:text-accent-foreground",

        link:
          "h-auto border border-transparent px-0 py-0 text-primary underline-offset-4 hover:underline",

        brand:
          "border border-primary/75 bg-primary text-primary-foreground " +
          "shadow-[0_10px_30px_rgba(0,0,0,0.40)] backdrop-blur-sm " +
          "hover:border-primary/90 hover:bg-primary/92",

        brandOutline:
          "border border-primary/75 bg-primary/18 text-foreground " +
          "shadow-[0_8px_22px_rgba(0,0,0,0.32)] backdrop-blur-sm " +
          "hover:border-primary/90 hover:bg-primary/28",

        success:
          "border border-emerald-400/60 bg-emerald-500/22 text-foreground " +
          "shadow-[0_8px_22px_rgba(0,0,0,0.28)] backdrop-blur-sm " +
          "hover:border-emerald-400/75 hover:bg-emerald-500/28",

        info:
          "border border-cyan-400/60 bg-cyan-500/22 text-foreground " +
          "shadow-[0_8px_22px_rgba(0,0,0,0.28)] backdrop-blur-sm " +
          "hover:border-cyan-400/75 hover:bg-cyan-500/28",

        warn:
          "border border-amber-400/60 bg-amber-500/22 text-foreground " +
          "shadow-[0_8px_22px_rgba(0,0,0,0.28)] backdrop-blur-sm " +
          "hover:border-amber-400/75 hover:bg-amber-500/28",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-lg px-3.5 text-xs",
        lg: "h-10 rounded-lg px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "outline", size: "default" }
  }
);