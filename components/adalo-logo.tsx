import Image from "next/image";

type AdaloLogoProps = {
  compact?: boolean;
  variant?: "horizontal" | "vertical";
};

export function AdaloLogo({ compact = false, variant = "horizontal" }: AdaloLogoProps) {
  if (variant === "vertical") {
    return (
      <div className="flex justify-center">
        <Image
          src="/adalo_logo_vertical.png"
          alt="ADALO Consulting Group"
          width={180}
          height={180}
          priority
          className="h-auto max-h-44 w-auto object-contain"
        />
      </div>
    );
  }

  return (
    <a
      href="https://www.adaloconsulting.com.ar"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Ir al sitio web de ADALO Consulting Group"
      className="flex min-w-0 items-center gap-3 rounded-2xl outline-none ring-brand-accent/30 transition hover:opacity-90 focus-visible:ring-4"
    >
      <Image
        src="/adalo_logo_horizontal.png"
        alt="ADALO Consulting Group"
        width={230}
        height={72}
        priority
        className={`h-auto max-h-16 w-auto max-w-[230px] object-contain ${
          compact ? "hidden sm:block" : "block"
        }`}
      />
      <Image
        src="/adalo_isotipo.png"
        alt="ADALO"
        width={48}
        height={48}
        priority
        className={`h-12 w-auto object-contain ${compact ? "block sm:hidden" : "hidden"}`}
      />
    </a>
  );
}
