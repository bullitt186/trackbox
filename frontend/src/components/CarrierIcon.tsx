import { getCarrierIcon } from "@/lib/carrier"

export function CarrierIcon({ carrier, size = 24 }: { carrier: string | null | undefined; size?: number }) {
  const src = getCarrierIcon(carrier)
  if (!src) return <span className="text-base">📦</span>
  return (
    <img
      src={src}
      alt={carrier ?? ""}
      width={size}
      height={size}
      className="object-contain shrink-0"
    />
  )
}
