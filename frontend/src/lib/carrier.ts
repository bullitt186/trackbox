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

export const CARRIER_DISPLAY: Record<string, { name: string; country: string }> = {
  dhl:        { name: "DHL Paket",        country: "Germany"       },
  hermes:     { name: "Hermes",           country: "Germany"       },
  dpd:        { name: "DPD",              country: "Germany"       },
  gls:        { name: "GLS",              country: "Germany"       },
  ups:        { name: "UPS",              country: "United States" },
  fedex:      { name: "FedEx",            country: "United States" },
  amazon:     { name: "Amazon Logistics", country: "Germany"       },
  usps:       { name: "USPS",             country: "United States" },
  cainiao:    { name: "Cainiao",          country: "China"         },
  yunexpress: { name: "YunExpress",       country: "China"         },
}

export function getCarrierIcon(carrier: string | null | undefined): string | null {
  if (!carrier) return null
  const key = carrier.toLowerCase()
  for (const [k, path] of Object.entries(CARRIER_ICONS)) {
    if (key.includes(k)) return path
  }
  return null
}

export function getCarrierDisplay(carrier: string | null | undefined): { name: string; country: string } | null {
  if (!carrier) return null
  const key = carrier.toLowerCase()
  for (const [k, display] of Object.entries(CARRIER_DISPLAY)) {
    if (key.includes(k)) return display
  }
  return { name: carrier, country: "" }
}
