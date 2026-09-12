import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Car, User, KeyRound, RefreshCw, Wrench, ClipboardCheck, LogIn, LogOut, AlertTriangle } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "../ui/dialog";

const ACTIONS = [
  { label: "Add Vehicle", icon: Car, path: "/fleet?new=1", testid: "qa-add-vehicle" },
  { label: "Add Driver", icon: User, path: "/drivers?new=1", testid: "qa-add-driver" },
  { label: "Create Rental", icon: KeyRound, path: "/rentals/new", testid: "qa-create-rental" },
  { label: "Renew Rental", icon: RefreshCw, path: "/rentals?status=expiring", testid: "qa-renew-rental" },
  { label: "Create Service Request", icon: Wrench, path: "/service-requests?new=1", testid: "qa-create-sr" },
  { label: "Record Vehicle Service", icon: ClipboardCheck, path: "/vehicle-service?new=1", testid: "qa-record-service" },
  { label: "Vehicle Handover", icon: LogIn, path: "/fleet?handover=1", testid: "qa-handover" },
  { label: "Vehicle Return", icon: LogOut, path: "/fleet?return=1", testid: "qa-return" },
  { label: "Report Incident", icon: AlertTriangle, path: "/incidents?new=1", testid: "qa-report-incident" },
];

export function QuickActionMenu({ open, setOpen }) {
  const nav = useNavigate();
  const actions = ACTIONS;
  const go = (p) => { setOpen(false); nav(p); };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-mv-surface border-mv-border text-mv-text max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">Quick Action</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2">
          {actions.map((a) => {
            const Icon = a.icon;
            return (
              <button key={a.label} onClick={() => go(a.path)} data-testid={a.testid}
                      className="mv-card-hover mv-card p-4 flex flex-col items-start gap-3 text-left">
                <div className="w-10 h-10 rounded-xl bg-mv-primary/15 flex items-center justify-center">
                  <Icon className="w-5 h-5 text-mv-primary" />
                </div>
                <span className="text-sm font-medium leading-tight">{a.label}</span>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function QuickActionButton({ onClick, floating }) {
  if (floating) {
    return (
      <button onClick={onClick} data-testid="quick-action-fab"
              className="lg:hidden fixed bottom-20 right-4 z-50 w-14 h-14 rounded-2xl bg-mv-primary shadow-lg shadow-blue-900/40 flex items-center justify-center active:scale-95 transition-transform">
        <Plus className="w-6 h-6 text-white" />
      </button>
    );
  }
  return (
    <button onClick={onClick} data-testid="quick-action-btn"
            className="hidden lg:inline-flex items-center gap-2 px-4 h-9 rounded-xl bg-mv-primary hover:bg-blue-600 text-white text-sm font-semibold transition-colors">
      <Plus className="w-4 h-4" /> Quick Action
    </button>
  );
}
