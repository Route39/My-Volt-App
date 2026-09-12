import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Check } from "lucide-react";
import api from "../../lib/api";
import { timeAgo } from "../../lib/format";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

const DOT = { red: "bg-red-500", amber: "bg-amber-500", green: "bg-green-500", blue: "bg-blue-500" };

export default function Notifications() {
  const [items, setItems] = useState([]);
  const nav = useNavigate();

  const load = async () => {
    try { const { data } = await api.get("/notifications"); setItems(data); } catch {}
  };
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, []);

  const unread = items.filter((i) => !i.read).length;
  const markAll = async () => { await api.post("/notifications/read-all"); load(); };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button data-testid="notifications-btn"
                className="relative w-9 h-9 rounded-xl border border-mv-border bg-mv-surface hover:bg-mv-elevated flex items-center justify-center transition-colors">
          <Bell className="w-4 h-4 text-mv-muted" />
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
              {unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] p-0 bg-mv-surface border-mv-border text-mv-text">
        <div className="flex items-center justify-between px-4 py-3 border-b border-mv-border">
          <span className="font-display font-semibold">Notifications</span>
          <button onClick={markAll} data-testid="mark-all-read" className="text-xs text-mv-primary hover:underline flex items-center gap-1">
            <Check className="w-3 h-3" /> Mark all read
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {items.length === 0 && <div className="p-8 text-center text-sm text-mv-dim">You're all caught up ✓</div>}
          {items.map((n) => (
            <button key={n.id} onClick={() => n.link && nav(n.link)}
                    className={`w-full text-left flex gap-3 px-4 py-3 border-b border-mv-border/50 hover:bg-mv-elevated transition-colors ${n.read ? "opacity-60" : ""}`}>
              <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${DOT[n.level] || "bg-zinc-500"}`} />
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{n.title}</div>
                <div className="text-xs text-mv-muted line-clamp-2">{n.message}</div>
                <div className="text-[11px] text-mv-dim mt-0.5">{timeAgo(n.created_at)}</div>
              </div>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
