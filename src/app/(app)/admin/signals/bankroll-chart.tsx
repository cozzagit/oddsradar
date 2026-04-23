'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';

export function BankrollChart({ data, start }: { data: Array<{ day: string; cumulativeBankroll: number; resolved: number; profit: number }>; start: number }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
          <XAxis dataKey="day" stroke="#71717a" tick={{ fontSize: 10 }} tickFormatter={(v: string) => v.slice(5)} />
          <YAxis
            stroke="#71717a"
            tick={{ fontSize: 10 }}
            domain={['auto', 'auto']}
            tickFormatter={(v: number) => `€${v.toFixed(0)}`}
          />
          <Tooltip
            contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 6, fontSize: 12 }}
            formatter={(v) => [`€${Number(v).toFixed(2)}`, 'Bankroll']}
          />
          <ReferenceLine y={start} stroke="#52525b" strokeDasharray="4 4" label={{ value: `€${start}`, fontSize: 10, fill: '#71717a' }} />
          <Line
            type="monotone"
            dataKey="cumulativeBankroll"
            stroke="#22d3ee"
            strokeWidth={2}
            dot={{ r: 3, fill: '#22d3ee' }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
