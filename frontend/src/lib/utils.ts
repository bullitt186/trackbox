import { type ClassValue, clsx } from 'clsx'

// ponytail: clsx placeholder until shadcn's cn() with twMerge is added
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs)
}

export function relativeTime(dateStr: string): string {
  const d = new Date(dateStr)
  const now = new Date()
  const diff = Math.floor((now.getTime() - d.getTime()) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 172800) return 'yesterday'
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
  return d.toLocaleDateString()
}

export const STATE_LABELS: Record<string, string> = {
  unknown: 'Unknown',
  preparing: 'Preparing',
  shipped: 'Shipped',
  in_transit: 'In Transit',
  out_for_delivery: 'Out for Delivery',
  delivered: 'Delivered',
  delayed: 'Delayed',
  exception: 'Exception',
}
