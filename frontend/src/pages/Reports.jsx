import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell, Tooltip } from "recharts";
import { Car, KeyRound, Wrench, ShieldAlert, Users, Wallet } from "lucide-react";
import api from "../lib/api";
import { useApp } from "../context/AppContext";
import { Skeleton } from "../components/common/Primitives";
import { PageHeader } from "../components/common/Page";
import { inr } from "../lib/format";

export default function Reports() {
  const { city } = useApp();
  const [data, setData] = useState(null);
  useEffect(() => { setData(null); api.get("/reports", { params: { city } }).then((r) => setData(r.data)); }, [city]);

  if (!data) return <div className="space-y-4"><Skeleton className="h-32 rounded-2xl" /><Skeleton className="h-72 rounded-2xl" /></div>;

  const cityData = data.fleet.by_city.map((c) => ({ name: c.city.slice(0, 3), Rented: c.rented, Available: c.available, Service: c.service }));

  const Section = ({ icon: Icon, title, stats }) => (
    <div className="mv-card p-5">
      <h3 className="font-display font-semibold flex items-center gap-2 mb-4"><Icon className="w-4 h-4 text-mv-primary" /> {title}</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {stats.map(([l, v, c]) => (<div key={l} className="mv-card bg-mv-surface2 p-3"><div className="mv-label">{l}</div><div className={`font-display text-xl font-bold mt-1 ${c || ""}`}>{v}</div></div>))}
      </div>
    </div>
  );

  return (
    <div>
      <PageHeader title="Reports" subtitle={`Fleet & rental operations · ${city === "all" ? "All Cities" : city}`} />
      <div className="space-y-4">
        <Section icon={Car} title="Fleet" stats={[["Total Fleet", data.fleet.total]]} />

        <div className="mv-card p-5">
          <h3 className="font-display font-semibold mb-4">Fleet by City</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={cityData} barGap={4}>
                <XAxis dataKey="name" stroke="#71717a" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#71717a" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip cursor={{ fill: "#0f172a08" }} contentStyle={{ background: "#ffffff", border: "1px solid #e6e8ee", borderRadius: 12, color: "#0f172a", boxShadow: "0 8px 24px rgba(16,24,40,.12)" }} />
                <Bar dataKey="Rented" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Available" fill="#22c55e" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Service" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <Section icon={KeyRound} title="Rentals" stats={[["Active", data.rentals.active, "text-green-400"], ["Total", data.rentals.total], ["Collected", inr(data.rentals.collected), "text-green-400"], ["Outstanding", inr(data.rentals.outstanding), "text-red-400"]]} />
        <Section icon={Wrench} title="Service" stats={[["Records", data.service.records], ["Open Requests", data.service.open_requests, "text-amber-400"], ["Total Cost", inr(data.service.total_cost)]]} />
        <Section icon={Users} title="Drivers" stats={[["Total", data.drivers.total], ["Active", data.drivers.active, "text-green-400"]]} />
        <Section icon={ShieldAlert} title="Compliance" stats={[["Expiring Soon", data.compliance.expiring, "text-amber-400"], ["Expired", data.compliance.expired, "text-red-400"]]} />
      </div>
    </div>
  );
}
