"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

type ChartSeriesPoint = {
  bucket_ts: string;
  success_rate?: number;
  failure_rate?: number;
  p95_duration_ms?: number;
  retry_rate?: number;
  duplicate_rate?: number;
  avg_cost_usd?: number;
};

export function MetricsChart({
  data,
  dataKey,
  color,
  title,
  unavailable = false
}: {
  data: ChartSeriesPoint[];
  dataKey: keyof ChartSeriesPoint;
  color: string;
  title: string;
  unavailable?: boolean;
}) {
  const isRateMetric = String(dataKey).endsWith("_rate");
  const hasData = data.length > 0;

  if (unavailable) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-panel">
        <p className="mb-2 text-sm font-semibold text-slate-700">{title}</p>
        <div className="grid h-56 place-items-center rounded-xl border border-amber-200 bg-amber-50 px-4 text-center text-sm text-amber-800">
          Monitoring data is temporarily unavailable. Check pipeline health and data source configuration.
        </div>
      </div>
    );
  }

  if (!hasData) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-panel">
        <p className="mb-2 text-sm font-semibold text-slate-700">{title}</p>
        <div className="grid h-56 place-items-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 text-center text-sm text-slate-600">
          No data yet. Run a simulation or connect a workflow to populate this chart.
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-panel">
      <p className="mb-2 text-sm font-semibold text-slate-700">{title}</p>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="bucket_ts"
              tick={{ fontSize: 11 }}
              tickFormatter={(value: string) => new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            />
            <YAxis
              tick={{ fontSize: 11 }}
              tickFormatter={(value: number) =>
                isRateMetric ? `${(Number(value) * 100).toFixed(0)}%` : Number(value).toFixed(0)
              }
            />
            <Tooltip
              labelFormatter={(value) => new Date(value).toLocaleString()}
              formatter={(value: number) =>
                isRateMetric ? `${(Number(value) * 100).toFixed(2)}%` : Number(value).toFixed(2)
              }
            />
            <Line type="monotone" dataKey={String(dataKey)} stroke={color} dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
