// Carrier icons: 50north.de shipping-icons-v14, CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)
// Full icon set in /public/carriers/ — filenames: lowercase, spaces → hyphens

const CARRIER_ICONS: Record<string, string> = {
  dhl: "/carriers/de-dhl.svg",
  hermes: "/carriers/de-hermes.svg",
  dpd: "/carriers/de-dpd.svg",
  gls: "/carriers/de-gls.svg",
  ups: "/carriers/us-ups.svg",
  fedex: "/carriers/us-fedex.svg",
  amazon: "/carriers/ww-amazon-logistics.svg",
}

export function getCarrierIcon(carrier: string | null | undefined): string | null {
  if (!carrier) return null
  const key = carrier.toLowerCase()
  for (const [k, path] of Object.entries(CARRIER_ICONS)) {
    if (key.includes(k)) return path
  }
  return null
}
