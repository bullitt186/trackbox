import { CheckCircle2, MinusCircle, AlertTriangle, Clock, Ban } from "lucide-react"

export function ScrapeStatusIcon({ status }: { status: string }) {
  switch (status) {
    case "success":
      return <span title="Success"><CheckCircle2 className="h-4 w-4 text-emerald-600" /></span>
    case "no_change":
      return <span title="No change"><MinusCircle className="h-4 w-4 text-muted-foreground" /></span>
    case "error":
      return <span title="Error"><AlertTriangle className="h-4 w-4 text-red-600" /></span>
    case "timeout":
      return <span title="Timeout"><Clock className="h-4 w-4 text-amber-600" /></span>
    case "disabled":
      return <span title="Disabled"><Ban className="h-4 w-4 text-red-600" /></span>
    default:
      return <span title="Unknown"><MinusCircle className="h-4 w-4 text-muted-foreground" /></span>
  }
}
