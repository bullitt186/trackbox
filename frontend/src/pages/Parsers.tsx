import { useEffect, useState, useMemo } from "react"
import { Trash2, ChevronDown, Cpu, Search } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { fetchParsers, deleteParser, type Parser } from "@/lib/api"
import { relativeTime, cn } from "@/lib/utils"

function useCountBadge(count: number) {
  if (count > 5) return "success" as const
  if (count > 0) return "warning" as const
  return "secondary" as const
}

function FieldMapView({ raw }: { raw: string }) {
  let parsed: Record<string, unknown> | null = null
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  } catch {
    // not JSON — show raw
  }

  if (!parsed) {
    return <pre className="text-xs bg-muted rounded p-3 overflow-x-auto font-mono whitespace-pre-wrap">{raw}</pre>
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
      {Object.entries(parsed).map(([k, v]) => (
        <div key={k} className="flex items-start gap-2 text-xs">
          <span className="text-muted-foreground shrink-0 font-medium min-w-[90px]">{k}</span>
          <code className="text-foreground font-mono truncate">{String(v)}</code>
        </div>
      ))}
    </div>
  )
}

function ParserCard({ parser, onDelete, isDuplicate }: { parser: Parser; onDelete: () => void; isDuplicate: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const badgeVariant = useCountBadge(parser.use_count)

  const keywords = parser.subject_keywords
    ? parser.subject_keywords.split(",").map(k => k.trim()).filter(Boolean)
    : []

  const handleDelete = async () => {
    setDeleting(true)
    await deleteParser(parser.id)
    onDelete()
  }

  return (
    <Card className={cn("transition-all", deleting && "opacity-50 pointer-events-none")}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base flex items-center gap-2">
              <Cpu className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="truncate">{parser.sender_domain}</span>
              {keywords.length > 0 && (
                <span className="text-muted-foreground font-normal text-sm truncate hidden sm:inline">
                  · {keywords.slice(0, 2).join(", ")}{keywords.length > 2 ? "…" : ""}
                </span>
              )}
            </CardTitle>
            {parser.created_at && (
              <CardDescription className="mt-0.5">
                Created {relativeTime(parser.created_at)}
              </CardDescription>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant={badgeVariant} title={`Used ${parser.use_count} time${parser.use_count !== 1 ? "s" : ""}`}>
              {parser.use_count} use{parser.use_count !== 1 ? "s" : ""}
            </Badge>
            {confirming ? (
              <div className="flex items-center gap-1">
                <Button size="sm" variant="destructive" onClick={handleDelete}>Confirm</Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
              </div>
            ) : (
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setConfirming(true)}
                aria-label="Delete parser"
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        {keywords.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {keywords.map(kw => (
              <Badge key={kw} variant="outline" className="text-xs font-normal">
                {kw}
              </Badge>
            ))}
          </div>
        )}

        {isDuplicate && (
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5">
            Multiple parsers for this domain — first keyword match wins.
          </p>
        )}
      </CardHeader>

      <CardContent className="pt-0">
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
          {expanded ? "Hide" : "Show"} field map
        </button>
        {expanded && (
          <div className="mt-3 p-3 rounded-lg bg-muted/50 border border-border">
            <FieldMapView raw={parser.field_map} />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default function Parsers() {
  const [parsers, setParsers] = useState<Parser[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")

  const load = async () => {
    const data = await fetchParsers()
    setParsers(data)
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  const domainCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const p of parsers) {
      counts[p.sender_domain] = (counts[p.sender_domain] ?? 0) + 1
    }
    return counts
  }, [parsers])

  const filtered = useMemo(() => {
    if (!search) return parsers
    const q = search.toLowerCase()
    return parsers.filter(p =>
      p.sender_domain.toLowerCase().includes(q) ||
      (p.subject_keywords || "").toLowerCase().includes(q)
    )
  }, [parsers, search])

  if (loading) {
    return (
      <div className="p-4 md:p-6 max-w-4xl mx-auto">
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-32 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold">Parsers</h1>
        <p className="text-sm text-muted-foreground">
          {parsers.length === 0
            ? "No parsers configured"
            : `${parsers.length} parser${parsers.length !== 1 ? "s" : ""} — email templates, one per sender, used to extract tracking info from incoming emails`}
        </p>
      </div>

      {parsers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Cpu className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <h3 className="font-semibold text-muted-foreground">No parsers yet</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Parsers are created automatically when emails are ingested.
          </p>
        </div>
      ) : (
        <>
          {parsers.length > 5 && (
            <div className="relative mb-4">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search domains or keywords"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-8 h-9 text-sm"
              />
            </div>
          )}

          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No parser rules match this filter.</p>
          ) : (
            <div className="space-y-4">
              {filtered.map(p => (
                <ParserCard
                  key={p.id}
                  parser={p}
                  isDuplicate={domainCounts[p.sender_domain] > 1}
                  onDelete={() => setParsers(prev => prev.filter(x => x.id !== p.id))}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
