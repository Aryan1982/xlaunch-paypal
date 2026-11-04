"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AgCharts } from "ag-charts-react";
import { AllCommunityModule as AllChartsModule, type AgCartesianChartOptions } from "ag-charts-community";
import { AgGridReact, type CustomCellRendererProps } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef } from "ag-grid-community";
import { Check, Copy, Download, Search } from "lucide-react";

import { cn } from "@/components/ui";
import type { CreditActivity as Row } from "@/lib/api";

/**
 * The account's credit history: AG Charts draws the balance over time (each
 * PayPal purchase a step up, each video a step down), and AG Grid lists every
 * change with search, type filters, sorting and CSV export. Loaded only on
 * the Credits page (next/dynamic), so neither library weighs on the rest.
 */

ModuleRegistry.registerModules([AllCommunityModule]);

/** The grid in the site's own colours: CSS variables, so it follows the light/dark toggle by itself. */
const gridTheme = themeQuartz.withParams({
  backgroundColor: "var(--panel)",
  foregroundColor: "var(--fg)",
  textColor: "var(--fg)",
  subtleTextColor: "var(--fg-mute)",
  borderColor: "var(--line)",
  accentColor: "var(--accent)",
  headerBackgroundColor: "var(--bg-raised)",
  headerTextColor: "var(--fg-mute)",
  headerFontWeight: 500,
  headerFontSize: 12,
  rowHoverColor: "var(--panel-hi)",
  selectedRowBackgroundColor: "var(--panel-hi)",
  oddRowBackgroundColor: "var(--panel)",
  fontFamily: "inherit",
  fontSize: 13,
  rowHeight: 44,
  headerHeight: 38,
  wrapperBorder: false,
  wrapperBorderRadius: 0,
  columnBorder: false,
  spacing: 7,
});

const KINDS = [
  { key: "all", label: "All" },
  { key: "purchase", label: "Purchases" },
  { key: "spend", label: "Videos" },
  { key: "refund", label: "Refunds" },
] as const;
type KindFilter = (typeof KINDS)[number]["key"];

const KIND_LABEL: Record<Row["kind"], string> = { purchase: "Purchase", spend: "Video", refund: "Refund", adjust: "Adjustment" };
const KIND_TONE: Record<Row["kind"], string> = {
  purchase: "bg-ok/12 text-ok",
  spend: "bg-accent/12 text-accent",
  refund: "bg-warn/12 text-warn",
  adjust: "bg-panel-hi text-mute",
};

const num = (n: number) => n.toLocaleString("en-US");
const when = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function KindCell({ data }: CustomCellRendererProps<Row>) {
  if (!data) return null;
  return (
    <span className="flex h-full items-center">
      <span className={cn("rounded-md px-2 py-0.5 text-[11px] font-medium leading-4", KIND_TONE[data.kind])}>{KIND_LABEL[data.kind]}</span>
    </span>
  );
}

function DescriptionCell({ data }: CustomCellRendererProps<Row>) {
  if (!data) return null;
  if (!data.projectId) return <span className="text-fg">{data.description}</span>;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 text-mute">{data.description}</span>
      <Link href={`/p/${data.projectId}`} className="truncate text-fg underline-offset-2 hover:underline">
        {data.projectTitle ?? "Deleted video"}
      </Link>
    </span>
  );
}

function CreditsCell({ data }: CustomCellRendererProps<Row>) {
  if (!data) return null;
  return (
    <span className={cn("font-medium tabular-nums", data.credits > 0 ? "text-ok" : data.credits < 0 ? "text-fg" : "text-mute")}>
      {data.credits > 0 ? "+" : ""}
      {num(data.credits)}
    </span>
  );
}

function OrderCell({ data }: CustomCellRendererProps<Row>) {
  const [copied, setCopied] = useState(false);
  if (!data?.paypalOrderId) return <span className="text-dim">—</span>;
  const id = data.paypalOrderId;
  return (
    <button
      type="button"
      title="Copy the PayPal order id"
      onClick={() => void navigator.clipboard.writeText(id).then(() => (setCopied(true), window.setTimeout(() => setCopied(false), 1200)))}
      className="group inline-flex cursor-pointer items-center gap-1.5 rounded-md font-mono text-xs text-mute transition-colors hover:text-fg"
    >
      {id}
      {copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />}
    </button>
  );
}

/** Resolved theme colours for the chart (a canvas can't read CSS variables), refreshed when the theme toggles. */
function useThemeColors() {
  const read = () => {
    const s = getComputedStyle(document.documentElement);
    const v = (name: string) => s.getPropertyValue(name).trim();
    return { dark: document.documentElement.dataset.theme === "dark", accent: v("--accent"), fg: v("--fg"), mute: v("--fg-mute"), line: v("--line"), panel: v("--panel") };
  };
  const [colors, setColors] = useState(read);
  useEffect(() => {
    const watch = new MutationObserver(() => setColors(read()));
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => watch.disconnect();
  }, []);
  return colors;
}

function BalanceChart({ rows }: { rows: Row[] }) {
  const c = useThemeColors();
  const options = useMemo<AgCartesianChartOptions>(() => {
    // oldest first, starting from the balance before the first change shown
    const points = [...rows].reverse().map((r) => ({ at: new Date(r.at), balance: r.balance, change: r.credits, label: r.description }));
    const first = rows.at(-1);
    if (first) points.unshift({ at: new Date(new Date(first.at).getTime() - 60_000), balance: first.balance - first.credits, change: 0, label: "Start" });
    return {
      data: points,
      background: { fill: c.panel },
      // the chart's own size: its default (300 px tall) overflows the 220 px box and covers the filters under it
      height: 220,
      padding: { top: 12, right: 16, bottom: 8, left: 8 },
      series: [
        {
          type: "area",
          xKey: "at",
          yKey: "balance",
          yName: "Balance",
          interpolation: { type: "step", position: "end" },
          fill: c.accent,
          fillOpacity: 0.14,
          stroke: c.accent,
          strokeWidth: 2,
          marker: { enabled: points.length <= 40, size: 5, fill: c.accent, stroke: c.panel, strokeWidth: 2 },
          tooltip: {
            renderer: ({ datum }) => ({
              heading: when.format(datum.at),
              title: datum.label,
              data: [
                { label: "Change", value: `${datum.change > 0 ? "+" : ""}${num(datum.change)}` },
                { label: "Balance", value: num(datum.balance) },
              ],
            }),
          },
        },
      ],
      axes: {
        x: { type: "time", position: "bottom", label: { color: c.mute, fontSize: 11 }, line: { stroke: c.line }, gridLine: { enabled: false } },
        y: { type: "number", position: "left", label: { color: c.mute, fontSize: 11, formatter: ({ value }) => num(Number(value)) }, gridLine: { style: [{ stroke: c.line, lineDash: [3, 3] }] } },
      },
      legend: { enabled: false },
    };
  }, [rows, c]);
  return <AgCharts options={options} modules={[AllChartsModule]} style={{ height: 220 }} />;
}

export default function CreditActivity({ rows }: { rows: Row[] }) {
  const grid = useRef<AgGridReact<Row>>(null);
  const [kind, setKind] = useState<KindFilter>("all");
  const [query, setQuery] = useState("");

  const shown = useMemo(() => (kind === "all" ? rows : rows.filter((r) => r.kind === kind)), [rows, kind]);
  const totals = useMemo(() => {
    let bought = 0;
    let used = 0;
    for (const r of rows) {
      // a refunded purchase takes its credits back off what was bought; a video refund gives back what it used
      if (r.kind === "purchase" || (r.kind === "refund" && r.paypalOrderId)) bought += r.credits;
      else if (r.kind === "spend" || r.kind === "refund") used -= r.credits;
    }
    const orders = new Set(rows.filter((r) => r.kind === "purchase" && r.paypalOrderId).map((r) => r.paypalOrderId)).size;
    return { bought, used: Math.max(0, used), orders };
  }, [rows]);

  const columns = useMemo<ColDef<Row>[]>(
    () => [
      { field: "at", headerName: "Date", width: 150, sort: "desc", valueFormatter: (p) => (p.value ? when.format(new Date(p.value)) : ""), comparator: (a: string, b: string) => Date.parse(a) - Date.parse(b) },
      { field: "kind", headerName: "Type", width: 116, cellRenderer: KindCell, valueFormatter: (p) => (p.value ? KIND_LABEL[p.value as Row["kind"]] : "") },
      { field: "description", headerName: "Details", flex: 1, minWidth: 220, cellRenderer: DescriptionCell, valueGetter: (p) => [p.data?.description, p.data?.projectTitle].filter(Boolean).join(" · ") },
      { field: "credits", headerName: "Credits", width: 110, type: "rightAligned", cellRenderer: CreditsCell },
      { field: "balance", headerName: "Balance", width: 110, type: "rightAligned", cellClass: "ag-right-aligned-cell tabular-nums text-mute", valueFormatter: (p) => num(Number(p.value ?? 0)) },
      { field: "paypalOrderId", headerName: "PayPal order", width: 200, cellRenderer: OrderCell },
    ],
    []
  );

  return (
    <section className="mt-10" aria-labelledby="activity-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="activity-title" className="text-lg font-medium">
            Activity
          </h2>
          <p className="mt-1 text-sm text-mute">Every PayPal purchase, video and refund on your credits.</p>
        </div>
        <dl className="flex gap-6 text-sm">
          {[
            ["Bought", num(totals.bought)],
            ["Used", num(totals.used)],
            ["PayPal orders", num(totals.orders)],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-dim">{label}</dt>
              <dd className="mt-0.5 font-medium tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-panel">
        {rows.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <p className="text-sm font-medium text-fg">No activity yet</p>
            <p className="mt-1 text-sm text-mute">Buy a pack with PayPal above: the purchase, and every video it pays for, shows up here.</p>
          </div>
        ) : (
          <>
            <div className="overflow-hidden border-b border-line px-2 pt-3">
              <BalanceChart rows={rows} />
            </div>
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
              <div role="tablist" aria-label="Show" className="flex gap-1 rounded-lg bg-panel-hi p-0.5">
                {KINDS.map((k) => (
                  <button
                    key={k.key}
                    type="button"
                    role="tab"
                    aria-selected={kind === k.key}
                    onClick={() => setKind(k.key)}
                    className={cn(
                      "cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition-[background-color,color] duration-150 active:scale-[0.97]",
                      kind === k.key ? "bg-panel text-fg shadow-sm" : "text-mute hover:text-fg"
                    )}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
              <label className="relative ml-auto flex items-center">
                <Search className="pointer-events-none absolute left-2.5 size-3.5 text-dim" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search videos, packs, orders"
                  aria-label="Search activity"
                  className="h-8 w-56 rounded-lg border border-line bg-bg pl-8 pr-3 text-xs text-fg outline-none transition-[border-color] placeholder:text-dim focus:border-accent"
                />
              </label>
              <button
                type="button"
                onClick={() =>
                  grid.current?.api.exportDataAsCsv({
                    fileName: "xlaunch-credits.csv",
                    columnKeys: ["at", "kind", "description", "credits", "balance", "paypalOrderId"],
                    // dates as ISO and plain numbers, so a spreadsheet reads them as dates and numbers
                    processCellCallback: (p) => (p.column.getColId() === "at" ? p.value : ["credits", "balance"].includes(p.column.getColId()) ? String(p.value) : p.formatValue(p.value)),
                  })
                }
                className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs font-medium text-mute transition-[color,border-color] hover:border-line-hi hover:text-fg active:scale-[0.97]"
              >
                <Download className="size-3.5" /> CSV
              </button>
            </div>
            <div style={{ height: Math.min(44 * 10 + 38, 44 * Math.max(shown.length, 3) + 38) }}>
              <AgGridReact<Row>
                ref={grid}
                theme={gridTheme}
                rowData={shown}
                columnDefs={columns}
                defaultColDef={{ sortable: true, resizable: true, suppressMovable: true }}
                quickFilterText={query}
                getRowId={(p) => String(p.data.id)}
                animateRows
                suppressCellFocus
                overlayNoRowsTemplate='<span style="color: var(--fg-mute); font-size: 13px">Nothing matches.</span>'
              />
            </div>
          </>
        )}
      </div>
    </section>
  );
}
