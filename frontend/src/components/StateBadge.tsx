import { Badge } from "@/components/ui/badge"
import type { BadgeProps } from "@/components/ui/badge"
import { STATE_LABELS } from "@/lib/utils"

type BadgeVariant = BadgeProps["variant"]

const STATE_VARIANTS: Record<string, BadgeVariant> = {
  delivered: "success",
  in_transit: "info",
  shipped: "info",
  out_for_delivery: "warning",
  delayed: "destructive",
  exception: "destructive",
  preparing: "secondary",
  unknown: "outline",
}

interface StateBadgeProps {
  state: string
  className?: string
}

export function StateBadge({ state, className }: StateBadgeProps) {
  const variant: BadgeVariant = STATE_VARIANTS[state] ?? "outline"
  return (
    <Badge variant={variant} className={className}>
      {STATE_LABELS[state] ?? state}
    </Badge>
  )
}
