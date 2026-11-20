import type { ReadinessStatus, Provenance } from "@bastion-guardian/types";

/** BASTION design tokens — dark, precise, high-contrast. */
export const tokens = {
  color: {
    bg: "#07090D",
    surface: "#0E121A",
    surfaceRaised: "#151A24",
    border: "#232A38",
    text: "#E6EAF2",
    textMuted: "#8A93A6",
    accent: "#5B8CFF",
    armed: "#2BD47D",
    limited: "#F5B83D",
    unavailable: "#FF5470",
    unknown: "#8A93A6",
  },
  radius: { sm: "6px", md: "10px", lg: "16px" },
  font: { sans: "Inter, ui-sans-serif, system-ui", mono: "JetBrains Mono, ui-monospace, monospace" },
} as const;

export const readinessPresentation: Record<
  ReadinessStatus,
  { label: string; color: string; description: string }
> = {
  ARMED: {
    label: "Armed",
    color: tokens.color.armed,
    description: "All Guardian checks pass. Readiness is not a guarantee of rescue success.",
  },
  LIMITED: {
    label: "Limited",
    color: tokens.color.limited,
    description: "Protection is available with reduced capacity or degraded signals.",
  },
  UNAVAILABLE: {
    label: "Unavailable",
    color: tokens.color.unavailable,
    description: "A required component failed — automatic rescue cannot currently run.",
  },
  UNKNOWN: {
    label: "Unknown",
    color: tokens.color.unknown,
    description: "Some Guardian inputs have not been observed yet.",
  },
};

export const provenanceLabel: Record<Provenance, string> = {
  ONCHAIN_FACT: "On-chain",
  DERIVED_ESTIMATE: "Estimate",
  SIMULATED: "Simulated",
  FIXTURE: "Test fixture",
};
