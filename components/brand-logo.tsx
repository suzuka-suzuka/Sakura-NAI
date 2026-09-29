import Image from "next/image";
import logoDark from "@/assets/brand/sakura-wordmark-dark.svg";
import logoLight from "@/assets/brand/sakura-wordmark-light.svg";
import mark from "@/assets/brand/sakura-mark.svg";
import { cn } from "@/lib/utils";

type BrandLogoProps = {
  variant?: "horizontal" | "mark";
  className?: string;
  priority?: boolean;
};

/** Sakura's five-petal blossom, with a wordmark for each theme. */
export function BrandLogo({ variant = "horizontal", className, priority = false }: BrandLogoProps) {
  const dark = variant === "horizontal" ? logoDark : mark;
  const light = variant === "horizontal" ? logoLight : mark;

  return (
    <span
      role="img"
      aria-label="Sakura NAI"
      className={cn("brand-logo relative inline-flex shrink-0", className)}
    >
      <Image
        src={dark}
        alt=""
        priority={priority}
        className="brand-logo-dark h-full w-full object-contain object-left"
      />
      <Image
        src={light}
        alt=""
        priority={priority}
        className="brand-logo-light absolute inset-0 h-full w-full object-contain object-left"
      />
    </span>
  );
}
