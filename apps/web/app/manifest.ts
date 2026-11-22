import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "BASTION Guardian",
    short_name: "BASTION",
    description: "Non-custodial cross-chain liquidation protection. Testnet software, not audited.",
    start_url: "/dashboard?source=pwa",
    scope: "/",
    display: "standalone",
    background_color: "#0b1220",
    theme_color: "#0b1220",
    categories: ["finance", "utilities"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      {
        name: "Emergency Action Center",
        url: "/emergency",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      { name: "Liquidation Radar", url: "/radar", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
