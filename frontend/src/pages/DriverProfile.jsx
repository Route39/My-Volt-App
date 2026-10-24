import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, User, Phone, MapPin, Car, KeyRound, History, FileText, AlertTriangle, ArrowRightLeft, Edit, Trash2, Search, Ban, Clock, ShieldCheck, CalendarDays, Check } from "lucide-react";
import { toast } from "sonner";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { StatusChip, Skeleton, KycStatusChip } from "../components/common/Primitives";
import { Field, PrimaryBtn, GhostBtn, TextInput } from "../components/common/Page";
import { fmtDate, inr } from "../lib/format";
import imgUrl from "../lib/imgUrl";
import { Avatar, AvatarFallback, AvatarImage } from "../components/ui/avatar";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Calendar } from "../components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { ReferralList } from "./Referrals";
import DriverAssignFields, { validateAssign } from "../components/DriverAssignFields";

// Odometer images uploaded by the driver from the driver app (Profile page)
function OdometerImagesTab({ driverId }) {
  const [images, setImages] = useState(null);
  useEffect(() => {
    api.get(`/admin/drivers/${driverId}/odometer-images`)
      .then(({ data }) => setImages(data.images || []))
      .catch(() => setImages([]));
  }, [driverId]);

  if (images === null) return <Skeleton className="h-40 rounded-2xl" />;
  if (images.length === 0) return <div className="mv-card p-10 text-center text-mv-muted text-sm">No odometer images uploaded yet</div>;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
      {images.map((im) => (
        <a key={im.id} href={imgUrl(im.url)} target="_blank" rel="noreferrer" className="mv-card overflow-hidden block">
          <img src={imgUrl(im.url)} alt="Odometer" className="w-full aspect-square object-cover" />
          <div className="px-3 py-2 text-xs text-mv-dim">{fmtDate(im.created_at)}</div>
        </a>
      ))}
    </div>
  );
}

export default function DriverProfile() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const [d, setD] = useState(null);
  const [assign, setAssign] = useState(false);
  const [edit, setEdit] = useState(false);
  const [del, setDel] = useState(false);
  const [blockType, setBlockType] = useState(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [partialOpen, setPartialOpen] = useState(false);
  const [rentOpen, setRentOpen] = useState(false);

  const load = useCallback(async () => { const { data } = await api.get(`/drivers/${id}`); setD(data); }, [id]);
  useEffect(() => { load(); }, [load]);

  if (!d) return <div className="space-y-4"><Skeleton className="h-40 rounded-2xl" /><Skeleton className="h-64 rounded-2xl" /></div>;
  const canEdit = ["admin", "city_manager"].includes(user?.role);
  const current = d.assignments?.find((a) => !a.end);
  const activeRental = d.rentals?.find((r) => r.status === "active");

  return (
    <div>
      <button onClick={() => nav(-1)} className="flex items-center gap-1.5 text-sm text-mv-muted hover:text-mv-text mb-4"><ArrowLeft className="w-4 h-4" /> Back</button>

      <div className="mv-card p-6 flex flex-col sm:flex-row sm:items-center gap-4 mv-rise">
        <Avatar className="w-20 h-20"><AvatarImage src={d.avatar} /><AvatarFallback className="bg-mv-elevated text-xl">{d.name.split(" ").map((s) => s[0]).slice(0, 2).join("")}</AvatarFallback></Avatar>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap"><h1 className="font-display text-2xl font-bold">{d.name}</h1>{d.driver_code && <span className="px-2.5 py-0.5 rounded-lg text-xs font-mono font-bold bg-blue-50 text-mv-primary border border-blue-100">{d.driver_code}</span>}<StatusChip status={d.status} />{d.admin_block && <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-600">{d.admin_block === "permanent" ? "Permanently Blocked" : "Temporarily Blocked"}</span>}{d.rental_status === "active" && <StatusChip status="active" label="Rental Active" />}</div>
          <div className="flex items-center gap-5 mt-2 text-sm text-mv-muted flex-wrap">
            <span className="flex items-center gap-1.5"><Phone className="w-4 h-4" /> {d.phone}</span>
            <span className="flex items-center gap-1.5"><MapPin className="w-4 h-4" /> {d.city}</span>
            <span className="flex items-center gap-1.5"><Car className="w-4 h-4" /> {d.current_vehicle_number || "No vehicle"}</span>
          </div>
        </div>
        {canEdit && (
            <div className="flex flex-wrap justify-end gap-2 sm:w-[864px] [&>button]:whitespace-nowrap [&>button]:w-[calc((100%_-_0.5rem)/2)] sm:[&>button]:w-[210px]">
            
            <GhostBtn onClick={() => setEdit(true)}><Edit className="w-4 h-4" /> Edit</GhostBtn>
            {/* {d.deposit_status !== "paid" ? (
              <GhostBtn onClick={async () => {
                if(window.confirm("Mark deposit as paid manually via QR?")) {
                  try {
                    await api.post(`/admin/drivers/${d.id}/deposit-paid`);
                    toast.success("Deposit marked as paid");
                    load();
                  } catch (e) {
                    toast.error(e.response?.data?.detail || "Failed to mark deposit as paid");
                  }
                }
              }} className="text-blue-600 hover:text-blue-700 hover:bg-blue-50">
                <Check className="w-4 h-4" /> Mark Deposit Paid (QR)
              </GhostBtn>
            ) : (
              <GhostBtn onClick={async () => {
                if(window.confirm("Mark deposit as UNPAID? This will prompt the driver to pay again.")) {
                  try {
                    await api.post(`/admin/drivers/${d.id}/deposit-unpaid`);
                    toast.success("Deposit marked as unpaid");
                    load();
                  } catch (e) {
                    toast.error(e.response?.data?.detail || "Failed to mark deposit as unpaid");
                  }
                }
              }} className="text-orange-600 hover:text-orange-700 hover:bg-orange-50">
                <AlertTriangle className="w-4 h-4" /> Mark Deposit Unpaid
              </GhostBtn>
            )} */}
                        {(() => {
              const partialOn = !!d.deposit_partial_enabled || d.deposit_status === "partial";
              const fullDone = d.deposit_status === "paid";
              const doneCls = "bg-emerald-50 text-emerald-700 border-emerald-300 cursor-default hover:bg-emerald-50";
              const doneClickCls = "bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100";
              return (
                <>
                  <GhostBtn
                    disabled={fullDone && !d.deposit_first_paid_at}
                    title={fullDone && !d.deposit_first_paid_at ? "Deposit already fully paid" : ""}
                    data-testid="enable-partial-deposit-btn"
                    onClick={async () => {
                      if (fullDone && !d.deposit_first_paid_at) return;
                      const enable = !partialOn;
                      if (enable || partialOn) { setPartialOpen(true); return; }  // open the form (new, or with the saved values) instead of a browser prompt
                      const msg = enable
                        ? "Enable partial deposit for this driver? The driver will be asked to pay HALF the deposit in the driver app and select a date for the remaining half."
                        : d.deposit_status === "partial"
                          ? "Disable partial deposit? The first half already paid will be reset and the driver will be asked for the FULL deposit again."
                          : "Disable partial deposit? The driver will be asked for the FULL deposit again.";
                      if (!window.confirm(msg)) return;
                      try {
                        await api.post(`/admin/drivers/${d.id}/deposit-partial-toggle`, { enabled: enable });
                        toast.success(enable ? "Partial deposit enabled" : "Partial deposit disabled");
                        load();
                      } catch (e) {
                        toast.error(e.response?.data?.detail || "Failed to update partial deposit option");
                      }
                    }}
                    className={(fullDone && !d.deposit_first_paid_at) ? "opacity-50 cursor-not-allowed " + (partialOn ? doneCls : "") : partialOn ? doneClickCls : "text-blue-600 hover:text-blue-700 hover:bg-blue-50"}>
                    <Check className="w-4 h-4" /> {partialOn ? "Partial Deposit Enabled" : "Enable Partial Deposit"}
                  </GhostBtn>
                  <GhostBtn
                    data-testid="mark-full-deposit-btn"
                    onClick={async () => {
                      if (fullDone) {
                        if (!window.confirm(d.deposit_partial_enabled ? "Mark deposit as UNPAID? The driver will be asked to pay the remaining half." : "Mark deposit as UNPAID? The driver will be asked to pay the full deposit again.")) return;
                        try {
                          await api.post(`/admin/drivers/${d.id}/deposit-full-unpaid`);
                          toast.success("Full deposit marked as unpaid");
                          load();
                        } catch (e) {
                          toast.error(e.response?.data?.detail || "Failed to mark full deposit as unpaid");
                        }
                        return;
                      }
                      if (window.confirm(d.deposit_status === "partial" ? "Mark the remaining half as paid (full deposit)?" : "Mark the FULL deposit as paid manually via QR?")) {
                        try {
                          await api.post(`/admin/drivers/${d.id}/deposit-paid`);
                          toast.success("Full deposit marked as paid");
                          load();
                        } catch (e) {
                          toast.error(e.response?.data?.detail || "Failed to mark full deposit as paid");
                        }
                      }
                    }}
                    className={fullDone ? "text-orange-600 hover:text-orange-700 hover:bg-orange-50" : "text-blue-600 hover:text-blue-700 hover:bg-blue-50"}>
                    {fullDone ? <AlertTriangle className="w-4 h-4" /> : <Check className="w-4 h-4" />} {fullDone ? "Mark Deposit Unpaid" : "Mark Deposit Paid (QR)"}
                  </GhostBtn>
                  {/* {partialDone && (
                    <GhostBtn onClick={async () => {
                      if (window.confirm("Mark deposit as UNPAID? This will prompt the driver to pay again.")) {
                        try {
                          await api.post(`/admin/drivers/${d.id}/deposit-unpaid`);
                          toast.success("Deposit marked as unpaid");
                          load();
                        } catch (e) {
                          toast.error(e.response?.data?.detail || "Failed to mark deposit as unpaid");
                        }
                      }
                    }} className="text-orange-600 hover:text-orange-700 hover:bg-orange-50">
                      <AlertTriangle className="w-4 h-4" /> Mark Deposit Unpaid
                    </GhostBtn>
                  )} */}
                </>
              );
            })()}
            <GhostBtn onClick={() => setRentOpen(true)} className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"><CalendarDays className="w-4 h-4" /> Rent Paid</GhostBtn>
            {d.admin_block ? (
              <GhostBtn onClick={() => setBlockType("unblock")} className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"><ShieldCheck className="w-4 h-4" /> Unblock</GhostBtn>
            ) : (
              <>
                <GhostBtn onClick={() => setLeaveOpen(true)} className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"><CalendarDays className="w-4 h-4" /> Paid Leave</GhostBtn>
                <GhostBtn onClick={() => setBlockType("temporary")} className="text-amber-600 hover:text-amber-700 hover:bg-amber-50"><Clock className="w-4 h-4" /> Temporary Block</GhostBtn>
                <GhostBtn onClick={() => setBlockType("permanent")} className="text-red-500 hover:text-red-600 hover:bg-red-50"><Ban className="w-4 h-4" /> Permanent Block</GhostBtn>
                <GhostBtn onClick={() => setAssign(true)} data-testid="assign-vehicle-btn"><ArrowRightLeft className="w-4 h-4" /> Change Vehicle</GhostBtn>
              </>
            )}
            {/* <GhostBtn onClick={() => setDel(true)} data-testid="delete-driver-btn" className="text-red-500 hover:text-red-600 hover:bg-red-50"><Trash2 className="w-4 h-4" /> Delete</GhostBtn> */}
          </div>
        )}
      </div>

      <Tabs defaultValue="personal" className="mt-6">
        <TabsList className="bg-mv-surface border border-mv-border flex-wrap h-auto">
          {["personal", "kyc", "documents", "vehicle", "rental", "history", "incidents", "referral", "odometer"].map((t) => <TabsTrigger key={t} value={t} className="data-[state=active]:bg-mv-elevated capitalize">{t === "odometer" ? "odometer image" : t}</TabsTrigger>)}
        </TabsList>

        <TabsContent value="personal" className="mt-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[["Driver ID", d.driver_code], ["Name", d.name], ["Phone", d.phone], ["Address", d.address], ["Emergency Contact", d.emergency_contact], ["Licence No.", d.license_number], ["City", d.city]].map(([k, v]) => (
              <div key={k} className="mv-card p-4"><div className="mv-label">{k}</div><div className="text-sm font-medium mt-1">{v || "—"}</div></div>
            ))}
            
            <div className="mv-card p-4" data-testid="next-half-payment-card">
              <div className="mv-label">Next Half Payment Date</div>
              <div className="text-sm font-medium mt-1">
                {d.deposit_status === "partial" ? (d.deposit_next_payment_date || "Date not set") : d.deposit_status === "paid" ? "Deposit fully paid" : (d.deposit_partial_enabled && d.deposit_partial_next_date) ? d.deposit_partial_next_date : "—"}
              </div>
              {d.deposit_partial_enabled && d.deposit_status !== "partial" && d.deposit_status !== "paid" && d.deposit_partial_first_amount > 0 && (
                <div className="text-[11px] text-mv-muted mt-0.5">Driver needs to pay first partial amount {inr(d.deposit_partial_first_amount)}</div>
              )}
              {d.deposit_status === "partial" && (
                <div className="text-[11px] text-mv-muted mt-0.5">{inr(d.deposit_remaining_amount)} remaining of {inr(d.deposit_amount)}</div>
              )}
            </div>

            <div className="mv-card p-4 flex flex-col justify-between">
              <div>
                <div className="mv-label">Paid Leaves (This Month)</div>
                <div className="text-sm font-medium mt-1 flex items-center gap-2">
                  {d.leaves_taken_this_month || 0}
                  {d.leave_dates_this_month?.length > 0 && <span className="text-[10px] text-mv-muted bg-mv-elevated px-1.5 py-0.5 rounded">({d.leave_dates_this_month.join(', ')})</span>}
                </div>
              </div>
                          {/* <button 
                onClick={async () => {
                  const date = window.prompt("Enter date to grant Paid Leave (YYYY-MM-DD):", new Date().toLocaleDateString('en-CA'));
                  if (date) {
                    try {
                      await api.post(`/admin/drivers/${d.id}/leave`, { date });
                      toast.success("Paid leave granted successfully!");
                      load();
                    } catch (e) {
                      toast.error(e.response?.data?.detail || "Failed to grant leave");
                    }
                  }
                }}
                className="mt-3 w-max text-[10px] bg-emerald-50 text-emerald-600 border border-emerald-200 hover:bg-emerald-100 font-bold px-2 py-1 rounded"
              >
                + Grant Leave
              </button> */}
            </div>
            
          <div className="mv-card p-4" data-testid="week-off-requests-card">
            <div className="mv-label">Requested week-offs</div>
            {(d.week_off_requests || []).length === 0 ? (
              <div className="text-sm text-mv-muted mt-1">No week-off requests this month.</div>
            ) : (d.week_off_requests || []).map((r) => (
              <div key={r.id} className="mt-3 pb-3 border-b border-mv-border last:border-0 last:pb-0">
                <div className="text-sm font-medium">{(r.dates || []).join(", ")}</div>
                <div className={`text-xs mt-0.5 capitalize ${r.status === "approved" ? "text-emerald-600" : r.status === "rejected" ? "text-red-500" : "text-amber-600"}`}>{r.status}</div>
                {r.status === "pending" && (
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={async () => {
                        try { await api.post(`/admin/drivers/${d.id}/week-off/${r.id}/approve`); toast.success("Week-off approved"); load(); }
                        catch (e) { toast.error(e.response?.data?.detail || "Failed to approve"); }
                      }}
                      className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-xs font-bold transition-colors">Approve</button>
                    <button
                      onClick={async () => {
                        try { await api.post(`/admin/drivers/${d.id}/week-off/${r.id}/reject`); toast.success("Week-off rejected"); load(); }
                        catch (e) { toast.error(e.response?.data?.detail || "Failed to reject"); }
                      }}
                      className="px-3 py-1.5 border border-red-200 text-red-600 hover:bg-red-50 rounded-lg text-xs font-bold transition-colors">Reject</button>
                  </div>
                )}
              </div>
            ))}
          </div>
          </div>
        </TabsContent>

        <TabsContent value="kyc" className="mt-4">
          <div className="mv-card p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-bold text-slate-900 text-lg">KYC Status</h3>
                <p className="text-sm text-slate-500">Current verification state of the driver's documents.</p>
              </div>
              <KycStatusChip status={d.kyc_status || "pending"} />
            </div>
            {d.kyc_status === "pending" || d.kyc_status === "submitted" ? (
              <div className="flex gap-3">
                <button onClick={async () => { await api.post(`/admin/kyc/${d.id}/approve`); toast.success("KYC Approved"); load(); }} className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-sm font-bold transition-colors">Approve KYC</button>
                <button onClick={async () => { await api.post(`/admin/kyc/${d.id}/reject`); toast.success("KYC Rejected"); load(); }} className="px-4 py-2 border border-red-200 text-red-600 hover:bg-red-50 rounded-xl text-sm font-bold transition-colors">Reject KYC</button>
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <KycDocCard title="Driving License (Front)" url={d.kyc_documents?.dl_front} />
            <KycDocCard title="Driving License (Back)" url={d.kyc_documents?.dl_back} />
            <KycDocCard title="Aadhaar Card" url={d.kyc_documents?.aadhaar} />
            <KycDocCard title="PAN Card" url={d.kyc_documents?.pan} />
            <KycDocCard title="Driver Photo" url={d.kyc_documents?.driver_photo} />
            <KycDocCard title="Driver + Vehicle" url={d.kyc_documents?.vehicle_photo} />
            <KycDocCard title="Rental Agreement" url={d.kyc_documents?.agreement} />
          </div>
        </TabsContent>

        <TabsContent value="documents" className="mt-4">
          {(d.documents || []).length === 0 ? <div className="mv-card p-10 text-center text-mv-muted text-sm">No documents.</div> : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">{d.documents.map((doc) => (
              <div key={doc.id} className="mv-card p-4 flex items-center justify-between"><div><div className="font-medium flex items-center gap-2"><FileText className="w-4 h-4 text-mv-dim" /> {doc.doc_type}</div><div className="text-xs text-mv-dim mt-1">Expires {fmtDate(doc.expiry_date)}</div></div><StatusChip status={doc.doc_status || "valid"} /></div>
            ))}</div>
          )}
        </TabsContent>

        <TabsContent value="vehicle" className="mt-4">
          {current ? (
            <button onClick={() => nav(`/fleet/${current.vehicle_id}`)} className="mv-card mv-card-hover p-5 w-full text-left">
              <div className="font-semibold flex items-center gap-2"><Car className="w-5 h-5 text-mv-primary" /> {current.vehicle_number}</div>
              <div className="text-sm text-mv-dim mt-1">Assigned {fmtDate(current.start, true)} · {current.city}</div>
            </button>
          ) : <div className="mv-card p-10 text-center text-mv-muted text-sm">No vehicle currently assigned.</div>}
        </TabsContent>

        <TabsContent value="rental" className="mt-4">
          {activeRental ? (
            <button onClick={() => nav(`/rentals/${activeRental.id}`)} className="mv-card mv-card-hover p-5 w-full text-left">
              <div className="flex items-center justify-between"><span className="font-semibold flex items-center gap-2"><KeyRound className="w-5 h-5 text-mv-primary" /> {activeRental.rental_code}</span><StatusChip status="active" /></div>
              <div className="text-sm text-mv-dim mt-2">{activeRental.plan_name} · {fmtDate(activeRental.start)} → {fmtDate(activeRental.end)}</div>
            </button>
          ) : <div className="mv-card p-10 text-center text-mv-muted text-sm">No active rental.</div>}
          {(d.rentals || []).length > 0 && <div className="mt-4"><div className="mv-label mb-2">Rental History</div><div className="mv-card divide-y divide-mv-border">{d.rentals.map((r) => (
            <button key={r.id} onClick={() => nav(`/rentals/${r.id}`)} className="w-full p-4 flex items-center justify-between hover:bg-mv-elevated transition-colors text-left"><div><div className="font-medium">{r.rental_code}</div><div className="text-xs text-mv-dim">{fmtDate(r.start)} → {fmtDate(r.end)}</div></div><StatusChip status={r.status} /></button>
          ))}</div></div>}
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          {(d.assignments || []).length === 0 ? <div className="mv-card p-10 text-center text-mv-muted text-sm">No assignment history.</div> : (
            <div className="mv-card divide-y divide-mv-border">{d.assignments.map((a) => (
              <div key={a.id} className="p-4 flex items-center justify-between"><div className="flex items-center gap-3"><History className="w-4 h-4 text-mv-dim" /><div><div className="font-medium">{a.vehicle_number}</div><div className="text-xs text-mv-dim">{fmtDate(a.start, true)} → {a.end ? fmtDate(a.end, true) : "Present"}</div></div></div>{!a.end && <StatusChip status="active" label="Current" />}</div>
            ))}</div>
          )}
        </TabsContent>

        <TabsContent value="incidents" className="mt-4">
          {(d.incidents || []).length === 0 ? <div className="mv-card p-10 text-center text-mv-muted text-sm">No incidents ✓</div> : (
            <div className="space-y-2">{d.incidents.map((i) => (<div key={i.id} className="mv-card p-4 flex items-center justify-between"><div><div className="font-medium">{i.code} · {i.incident_type}</div><div className="text-xs text-mv-dim">{fmtDate(i.created_at)}</div></div><StatusChip status={i.status} /></div>))}</div>
          )}
        </TabsContent>
        <TabsContent value="referral" className="mt-4">
          <ReferralList referrerId={d.id} referrerName={d.name} referrerCode={d.driver_code} showReferrer={false} />
        </TabsContent>
        <TabsContent value="odometer" className="mt-4">
          <OdometerImagesTab driverId={d.id} />
        </TabsContent>
      </Tabs>

      <AssignVehicleDialog open={assign} setOpen={setAssign} driver={d} onDone={() => { setAssign(false); load(); }} />
      <EditDriverDialog open={edit} setOpen={setEdit} driver={d} onDone={() => { setEdit(false); load(); }} />
      <BlockDriverDialog type={blockType} setType={setBlockType} driver={d} onDone={() => { setBlockType(null); load(); }} />
      <PartialDepositDialog open={partialOpen} setOpen={setPartialOpen} driver={d} onDone={(v) => {
        setPartialOpen(false);
        // show the saved values in the card immediately, then reload from the server
        if (v) setD((p) => ({ ...p, deposit_partial_enabled: true, deposit_partial_first_amount: v.first_amount, deposit_partial_next_date: v.next_payment_date, deposit_amount: v.total || p.deposit_amount }));
        load();
      }} />
      <RentPaidDialog open={rentOpen} setOpen={setRentOpen} driver={d} onDone={() => { setRentOpen(false); load(); }} />
      <PaidLeaveDialog open={leaveOpen} setOpen={setLeaveOpen} driver={d} onDone={() => { setLeaveOpen(false); load(); }} />
      <DeleteDriverDialog open={del} setOpen={setDel} driver={d} onDone={() => { setDel(false); nav("/drivers"); }} />
    </div>
  );
}

function PartialDepositDialog({ open, setOpen, driver, onDone }) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(undefined);
  const [busy, setBusy] = useState(false);
  const [firstPaid, setFirstPaid] = useState(false);       // "Partial deposit amount paid" toggle
  const [paidDate, setPaidDate] = useState(undefined);     // date the partial amount was paid
  const [secondPaid, setSecondPaid] = useState(false);     // "Remaining deposit amount paid" toggle
  const [secondDate, setSecondDate] = useState(undefined);  // date the remaining amount was paid
  const [firstTxn, setFirstTxn] = useState("");             // transaction id of the partial amount
  const [secondTxn, setSecondTxn] = useState("");           // transaction id of the remaining amount
  // driver already has partial deposit enabled -> the form opens with the saved values
  const manage = !!driver?.deposit_partial_enabled || driver?.deposit_status === "partial" || (driver?.deposit_status === "paid" && !!driver?.deposit_first_paid_at);
  const toDate = (s) => { if (!s) return undefined; const [y, m, dd] = String(s).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, dd); };
  const disable = async () => {
    const msg = driver?.deposit_status === "partial"
      ? "Disable partial deposit? The first half already paid will be reset and the driver will be asked for the FULL deposit again."
      : "Disable partial deposit? The driver will be asked for the FULL deposit again.";
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      await api.post(`/admin/drivers/${driver.id}/deposit-partial-toggle`, { enabled: false });
      toast.success("Partial deposit disabled");
      onDone();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to update partial deposit option");
    } finally { setBusy(false); }
  };
  const total = Number(driver?.deposit_amount || 0);
  const toKey = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  const tomorrow = new Date();
  tomorrow.setHours(0, 0, 0, 0);
  tomorrow.setDate(tomorrow.getDate() + 1);

  useEffect(() => {
    if (!open) return;
    const paid1 = !!driver?.deposit_first_paid_at && ["partial", "paid"].includes(driver?.deposit_status);
    const paid2 = driver?.deposit_status === "paid" && !!driver?.deposit_second_paid_at;
    const savedFirst = driver?.deposit_partial_first_amount || driver?.deposit_first_amount || (Number(driver?.deposit_amount) ? Number(driver.deposit_amount) / 2 : "");
    const savedNext = driver?.deposit_next_payment_date || driver?.deposit_partial_next_date;
    setAmount(manage && savedFirst ? String(savedFirst) : "");
    setDate(manage ? toDate(savedNext) : undefined);
    setFirstPaid(manage && paid1);
    setPaidDate(manage && paid1 ? toDate(driver.deposit_first_paid_at) : undefined);
    setSecondPaid(manage && paid2);
    setSecondDate(manage && paid2 ? toDate(driver.deposit_second_paid_at) : undefined);
    setFirstTxn(manage && paid1 ? (driver.deposit_first_txn || "") : "");
    setSecondTxn(manage && paid2 ? (driver.deposit_second_txn || "") : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const first = Number(amount) || 0;
  const amountOk = first > 0 && first < total;
  const remaining = amountOk ? Math.round((total - first) * 100) / 100 : "";

  // Exactly ONE of the two dates is used: "Date for next payment" OR "date the remaining amount was paid".
  const hasNext = !!date;
  const hasSecond = secondPaid && !!secondDate;
  const dateOk = manage || hasNext || hasSecond;   // Enable is allowed when either date is chosen

  const save = async () => {
    if (!amountOk) return toast.error(`Enter an amount more than 0 and less than ${inr(total)}`);
    if (!manage && !hasNext && !hasSecond) return toast.error("Select the date for the next payment OR the date the remaining amount was paid");
    if (!manage && hasNext && secondPaid) return toast.error("Select only one date: next payment date or remaining amount paid date");
    if (firstPaid && !paidDate) return toast.error("Select the date when the partial amount was paid");
    if (secondPaid && !secondDate) return toast.error("Select the date when the remaining amount was paid");
    if (firstPaid && paidDate && !firstTxn.trim()) return toast.error("Enter the transaction ID for the partial amount");
    if (secondPaid && secondDate && !secondTxn.trim()) return toast.error("Enter the transaction ID for the remaining amount");
    setBusy(true);
    try {
      if (manage) {
        // already enabled: only update paid / unpaid (amount and next payment date stay as saved)
        await api.post(`/admin/drivers/${driver.id}/deposit-partial-payments`, {
          first_paid: firstPaid, first_paid_date: firstPaid ? toKey(paidDate) : null,
          second_paid: secondPaid, second_paid_date: secondPaid ? toKey(secondDate) : null,
          first_txn_id: firstPaid ? firstTxn.trim() : null, second_txn_id: secondPaid ? secondTxn.trim() : null,
        });
        toast.success("Partial deposit updated");
        onDone();
        return;
      }
      const { data } = await api.post(`/admin/drivers/${driver.id}/deposit-partial-toggle`, {
        enabled: true, first_amount: first, next_payment_date: date ? toKey(date) : null,
        ...(firstPaid ? { first_paid: true, first_paid_date: toKey(paidDate), second_paid: secondPaid, second_paid_date: secondPaid ? toKey(secondDate) : null, first_txn_id: firstTxn.trim(), second_txn_id: secondPaid ? secondTxn.trim() : null } : {}),
      });
      toast.success("Partial deposit enabled");
      onDone({ first_amount: first, next_payment_date: date ? toKey(date) : null, total: data?.total });
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to enable partial deposit");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto" data-testid="partial-deposit-dialog">
        <DialogHeader><DialogTitle>Enable Partial Deposit</DialogTitle></DialogHeader>
        <p className="text-sm text-mv-muted">Total security deposit: <b>{inr(total)}</b></p>
        <Field label="Partial Deposit Amount">
          <TextInput type="number" min="1" max={total} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Enter amount" disabled={manage} data-testid="partial-first-amount" />
        </Field>
        <Field label="Date for next payment">
          {manage ? (
            <TextInput value={date ? toKey(date) : ""} readOnly disabled data-testid="partial-next-date" />
          ) : (
            <>
              <PaidDateField
                testId="partial-next-date-field"
                placeholder="Select the date for next payment"
                value={date}
                onChange={setDate}
                disabledDay={(day) => day < tomorrow || secondPaid}
              />
              <p className="text-xs text-mv-muted mt-1">{secondPaid ? "Disabled: the remaining amount is marked as paid (switch that off to pick a next payment date)" : date ? `Selected: ${toKey(date)}` : "Pick a date from tomorrow onwards"}</p>
            </>
          )}
        </Field>
        <Field label="Remaining amount (auto)">
          <TextInput value={remaining === "" ? "" : String(remaining)} readOnly disabled placeholder="Calculated automatically" data-testid="partial-remaining-amount" />
        </Field>
        <div className="flex flex-col gap-2">
          <GhostBtn
            type="button"
            data-testid="partial-first-paid-btn"
            disabled={firstPaid && secondPaid}
            title={firstPaid && secondPaid ? "Mark the remaining deposit amount as unpaid first" : ""}
            onClick={() => { const v = !firstPaid; setFirstPaid(v); if (!v) { setPaidDate(undefined); setSecondPaid(false); setSecondDate(undefined); setFirstTxn(""); setSecondTxn(""); } }}
            className={(firstPaid ? "bg-red-50 text-red-600 border-red-300 hover:bg-red-100" : "text-blue-600 hover:text-blue-700 hover:bg-blue-50") + " disabled:opacity-50 disabled:cursor-not-allowed"}>
            {firstPaid ? "Partial deposit amount unpaid" : "Partial deposit amount paid"}
          </GhostBtn>
          {firstPaid && (
            <>
              <PaidDateField
                testId="partial-paid-date-field"
                label="Select the date when the partial amount paid"
                placeholder="Select the date the partial amount was paid"
                value={paidDate}
                onChange={setPaidDate}
                disabledDay={(day) => day > new Date()}
              />
              <Field label={`Enter transaction ID${paidDate ? " *" : ""}`}>
                <TextInput value={firstTxn} onChange={(e) => setFirstTxn(e.target.value)} placeholder="Enter transaction ID" data-testid="partial-first-txn" />
              </Field>
            </>
          )}
          <GhostBtn
            type="button"
            data-testid="partial-second-paid-btn"
            disabled={!firstPaid || (hasNext && !secondPaid)}
            title={!firstPaid ? "Mark the partial deposit amount as paid first" : (hasNext && !secondPaid) ? "Clear the next payment date first (only one date can be selected)" : ""}
            onClick={() => { const v = !secondPaid; setSecondPaid(v); if (!v) { setSecondDate(undefined); setSecondTxn(""); } }}
            className={secondPaid ? "bg-red-50 text-red-600 border-red-300 hover:bg-red-100" : "text-blue-600 hover:text-blue-700 hover:bg-blue-50"}>
            {secondPaid ? "Remaining deposit amount unpaid" : "Remaining deposit amount paid"}
          </GhostBtn>
          {secondPaid && (
            <>
              <PaidDateField
                testId="remaining-paid-date-field"
                label="Select the date when the remaining amount paid"
                placeholder="Select the date the remaining amount was paid"
                value={secondDate}
                onChange={setSecondDate}
                disabledDay={(day) => day > new Date() || (paidDate && day < paidDate) || hasNext}
              />
              <Field label={`Enter transaction ID${secondDate ? " *" : ""}`}>
                <TextInput value={secondTxn} onChange={(e) => setSecondTxn(e.target.value)} placeholder="Enter transaction ID" data-testid="partial-second-txn" />
              </Field>
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 mt-2">
          {manage && driver?.deposit_status !== "paid" && (
            <GhostBtn type="button" onClick={disable} disabled={busy} data-testid="partial-disable-btn"
              className="mr-auto text-red-600 hover:text-red-700 hover:bg-red-50">Disable partial deposit</GhostBtn>
          )}
          <GhostBtn onClick={() => setOpen(false)}>Cancel</GhostBtn>
          <PrimaryBtn onClick={save} disabled={busy || !amountOk || !dateOk || (firstPaid && !paidDate) || (secondPaid && !secondDate) || (firstPaid && paidDate && !firstTxn.trim()) || (secondPaid && secondDate && !secondTxn.trim())}>{busy ? "Please wait..." : manage ? "Save" : "Enable"}</PrimaryBtn>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Read-only date field with a calendar icon. The calendar opens only when the field / icon is clicked,
// and the chosen day is written into the field only after pressing OK.
function PaidDateField({ label, value, onChange, disabledDay, placeholder, testId }) {
  const [open, setOpen] = useState(false);
  const [temp, setTemp] = useState(undefined);
  const fmt = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  const openCal = () => { setTemp(value); setOpen(true); };
  return (
    <div data-testid={testId}>
      {label && <div className="text-xs font-semibold text-mv-muted mb-1.5">{label}</div>}
      <div className="relative">
        <button type="button" onClick={openCal}
          className="w-full h-10 px-3 pr-10 text-left rounded-xl border border-mv-border bg-mv-surface2 text-sm hover:border-mv-primary transition-colors">
          {value ? fmt(value) : <span className="text-mv-muted">{placeholder || "Select date"}</span>}
        </button>
        <CalendarDays className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-mv-muted pointer-events-none" />
      </div>
      {open && (
        <div className="mt-2 rounded-xl border border-mv-border">
          <div className="flex justify-center">
            <Calendar mode="single" selected={temp} onSelect={setTemp} defaultMonth={temp || value} disabled={disabledDay} />
          </div>
          <div className="flex justify-end gap-2 p-2 border-t border-mv-border">
            <GhostBtn type="button" onClick={() => setOpen(false)}>Cancel</GhostBtn>
            <PrimaryBtn type="button" disabled={!temp} onClick={() => { onChange(temp); setOpen(false); }}>OK</PrimaryBtn>
          </div>
        </div>
      )}
    </div>
  );
}

function AssignVehicleDialog({ open, setOpen, driver, onDone }) {
  const [vehicles, setVehicles] = useState([]);
  const [vid, setVid] = useState("");
  useEffect(() => { if (open) api.get("/vehicles", { params: { status: "available", page_size: 100 } }).then((r) => setVehicles(r.data.items)); }, [open]);
  const save = async () => {
    if (!vid) { toast.error("Select a vehicle"); return; }
    try { await api.post(`/drivers/${driver.id}/assign-vehicle`, { vehicle_id: vid }); toast.success("Driver assigned ✓"); onDone(); } catch { toast.error("Failed"); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-mv-surface border-mv-border text-mv-text">
        <DialogHeader><DialogTitle className="font-display">Assign Vehicle</DialogTitle></DialogHeader>
        <Field label="Available Vehicle">
          <Select value={vid} onValueChange={setVid}>
            <SelectTrigger className="h-10 bg-mv-surface2 border-mv-border" data-testid="assign-vehicle-select"><SelectValue placeholder="Select vehicle" /></SelectTrigger>
            <SelectContent className="bg-mv-surface border-mv-border text-mv-text max-h-64">{vehicles.map((v) => <SelectItem key={v.id} value={v.id}>{v.vehicle_number} · {v.city}{v.registration_number ? ` · ${v.registration_number}` : ''}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <div className="flex justify-end pt-1"><PrimaryBtn onClick={save} data-testid="save-assign-btn">Assign</PrimaryBtn></div>
      </DialogContent>
    </Dialog>
  );
}

import { CITIES, useApp } from "../context/AppContext";

function EditDriverDialog({ open, setOpen, driver, onDone }) {
  const [form, setForm] = useState({ name: "", phone: "", city: "", address: "", emergency_contact: "", license_number: "", status: "", vehicle_id: "", package_id: "", rental_start: "", rental_end: "", supervisor_id: "", rental_state: "" });
  const [saving, setSaving] = useState(false);
  const { lockedCity } = useApp(); // city managers: own city only; admins: all cities
  const openR = (driver?.rentals || []).find((x) => x.status !== "closed");
  const assigned = (openR || (driver?.rental_status === "active" && driver?.current_vehicle_number)) ? {
    vehicle: openR?.vehicle_number || driver?.current_vehicle_number,
    package: openR?.package_name || openR?.plan_name || driver?.package_name,
    start: openR?.start, end: openR?.end, code: openR?.rental_code,
    hasRental: !!openR, state: openR?.status || driver?.rental_status,
  } : null;

  useEffect(() => {
    if (open && driver) setForm({ name: driver.name, phone: driver.phone, city: driver.city, address: driver.address || "", emergency_contact: driver.emergency_contact || "", license_number: driver.license_number || "", status: driver.status, vehicle_id: "", package_id: "", rental_start: "", rental_end: "", supervisor_id: driver.supervisor_id || "", rental_state: ((driver.rentals || []).find((x) => x.status !== "closed") || {}).status || "" });
  }, [open, driver]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    if (!form.name || !form.phone) { toast.error("Name & phone required"); return; }
    if (!assigned) {
      const err = validateAssign(form);
      if (err) { toast.error(err); return; }
    }
    if (!/^\d{10}$/.test(form.phone) || (form.emergency_contact && !/^\d{10}$/.test(form.emergency_contact))) {
      toast.error("Phone and Emergency Contact must be exactly 10 digits");
      return;
    }
    setSaving(true);
    try { await api.put(`/drivers/${driver.id}`, form); toast.success("Driver updated ✓"); onDone(); } catch (e) { toast.error(e.response?.data?.detail || "Failed to update"); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-mv-surface border-mv-border text-mv-text">
        <DialogHeader><DialogTitle className="font-display">Edit Driver</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4 pt-2 max-h-[65vh] overflow-y-auto pr-1">
          <Field label="Name"><TextInput value={form.name} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="Phone"><TextInput value={form.phone} inputMode="numeric" maxLength={10} onChange={(e) => set("phone", e.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="10-digit mobile number" /></Field>
          <Field label="City">
            <Select value={form.city} onValueChange={(v) => set("city", v)}>
              <SelectTrigger className="h-10 bg-mv-surface2 border-mv-border"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-mv-surface border-mv-border text-mv-text">{(lockedCity ? [lockedCity] : CITIES).map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Status">
            <Select value={form.status} onValueChange={(v) => set("status", v)}>
              <SelectTrigger className="h-10 bg-mv-surface2 border-mv-border"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-mv-surface border-mv-border text-mv-text"><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent>
            </Select>
          </Field>
          <Field label="Licence No."><TextInput value={form.license_number} onChange={(e) => set("license_number", e.target.value)} /></Field>
          <Field label="Emergency Contact"><TextInput value={form.emergency_contact} inputMode="numeric" maxLength={10} onChange={(e) => set("emergency_contact", e.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="10-digit mobile number" /></Field>
          <div className="col-span-2"><Field label="Address"><TextInput value={form.address} onChange={(e) => set("address", e.target.value)} /></Field></div>
          <DriverAssignFields
            city={form.city} form={form} set={set}
            assigned={assigned}
          />
        </div>
        <div className="flex justify-end pt-1"><PrimaryBtn onClick={save} disabled={saving}>Save Changes</PrimaryBtn></div>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDriverDialog({ open, setOpen, driver, onDone }) {
  const [deleting, setDeleting] = useState(false);
  const [unpaidError, setUnpaidError] = useState(null);

  const doDelete = async (force = false) => {
    setDeleting(true);
    setUnpaidError(null);
    try {
      await api.delete(`/drivers/${driver.id}?force=${force}`);
      toast.success("Driver deleted successfully");
      onDone();
    } catch (e) {
      const status = e.response?.status;
      const detail = e.response?.data?.detail || "Failed to delete";
      if (status === 409) {
        // Unpaid balance warning — show force delete option
        setUnpaidError(detail);
      } else {
        toast.error(detail);
        setOpen(false);
      }
    } finally {
      setDeleting(false);
    }
  };

  const handleClose = () => { setUnpaidError(null); setOpen(false); };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="bg-mv-surface border-mv-border text-mv-text">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2 text-red-500">
            <AlertTriangle className="w-5 h-5" /> Delete Driver
          </DialogTitle>
        </DialogHeader>

        {!unpaidError ? (
          <>
            <p className="text-sm text-mv-muted">
              Are you sure you want to permanently delete driver <strong>{driver?.name}</strong>? 
              All their rentals, payments and records will be deleted. This cannot be undone.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <GhostBtn onClick={handleClose}>Cancel</GhostBtn>
              <PrimaryBtn onClick={() => doDelete(false)} disabled={deleting} className="bg-red-500 hover:bg-red-600 text-white">
                {deleting ? "Deleting..." : "Delete"}
              </PrimaryBtn>
            </div>
          </>
        ) : (
          <>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <p className="text-sm font-semibold text-amber-800 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" /> Unpaid Balance Found
              </p>
              <p className="text-sm text-amber-700 mt-1">{unpaidError}</p>
            </div>
            <p className="text-sm text-mv-muted mt-1">
              You can still force delete this driver. All their data including unpaid dues will be permanently removed.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <GhostBtn onClick={handleClose}>Cancel</GhostBtn>
              <PrimaryBtn onClick={() => doDelete(true)} disabled={deleting} className="bg-red-500 hover:bg-red-600 text-white">
                {deleting ? "Deleting..." : "Force Delete Anyway"}
              </PrimaryBtn>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}


function KycDocCard({ title, url }) {
  if (!url) return <div className="aspect-video bg-slate-100 rounded-2xl flex items-center justify-center text-slate-400 text-sm">Not Provided</div>;
  const fullUrl = imgUrl(url);
  return (
    <div className="space-y-2">
      <h4 className="font-semibold text-slate-700 text-sm">{title}</h4>
      <div className="aspect-video bg-black rounded-2xl overflow-hidden shadow-sm relative group cursor-pointer" onClick={() => window.open(fullUrl, '_blank')}>
        <img src={fullUrl} alt={title} className="w-full h-full object-contain" />
        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <Search className="w-8 h-8 text-white" />
        </div>
      </div>
    </div>
  );
}

function RentPaidDialog({ open, setOpen, driver, onDone }) {
  const [sel, setSel] = useState([]);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const toKey = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  const [txns, setTxns] = useState({});
  const [amts, setAmts] = useState({});        // amount per date (saved dates keep their own amount)
  const [saved, setSaved] = useState([]);      // days already marked paid earlier: [{ date, amount, txn_id }]
  const [loading, setLoading] = useState(false);
  const toDate = (s) => { const [y, m, dd] = s.split("-").map(Number); return new Date(y, m - 1, dd); };
  useEffect(() => {
    if (!open || !driver?.id) return;
    setSel([]); setAmount(""); setTxns({}); setAmts({}); setSaved([]);
    setLoading(true);
    api.get(`/admin/drivers/${driver.id}/rent-paid`)
      .then(({ data }) => {
        const items = data.items || [];
        setSaved(items);
        setSel(items.map((x) => toDate(x.date)));
        setTxns(Object.fromEntries(items.map((x) => [x.date, x.txn_id || ""])));
        setAmts(Object.fromEntries(items.map((x) => [x.date, String(x.amount)])));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, driver?.id]);
  const amt = Number(amount) || 0;
  const amtFor = (k) => Number(amts[k] ?? amount) || 0;
  const total = Math.round(sel.map(toKey).reduce((s, k) => s + amtFor(k), 0) * 100) / 100;

  const save = async () => {
    if (!sel.length && !saved.length) return toast.error("Select at least one date");
    const keys = sel.map(toKey).sort();
    if (keys.some((k) => amtFor(k) <= 0)) return toast.error("Enter a valid amount for every selected date");
    const removing = saved.filter((x) => !keys.includes(x.date));
    if (removing.length && !window.confirm(`Remove rent paid for ${removing.map((x) => x.date).join(", ")}? These days will become unpaid again.`)) return;
    setBusy(true);
    try {
      await api.put(`/admin/drivers/${driver.id}/rent-paid`, {
        entries: keys.map((k) => ({ date: k, amount: amtFor(k), txn_id: (txns[k] || "").trim() })),
      });
      toast.success("Rent paid details saved");
      onDone();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to mark rent as paid");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Rent Paid</DialogTitle></DialogHeader>
        <div className="flex justify-center rounded-xl border border-mv-border">
          <Calendar mode="multiple" selected={sel} onSelect={(v) => setSel(v || [])} disabled={(day) => day > new Date()} />
        </div>
        {loading && <p className="text-sm text-mv-muted">Loading saved rent details...</p>}
        {saved.length > 0 && (
          <p className="text-xs text-mv-muted">Days already marked paid are pre-selected. Change their transaction ID / amount, or un-select a day to remove it.</p>
        )}
        {sel.length > 0 && (
          <>
            <div className="space-y-2">
              <div className="mv-label">Transaction ID and amount (per date)</div>
              {sel.map(toKey).sort().map((k) => (
                <div key={k} className="flex items-center gap-2">
                  <span className="text-sm font-medium w-24 shrink-0">{k}</span>
                  <div className="flex-1 min-w-0">
                    <TextInput value={txns[k] || ""} onChange={(e) => setTxns((t) => ({ ...t, [k]: e.target.value }))} placeholder="Transaction ID" />
                  </div>
                  <div className="w-24 shrink-0">
                    <TextInput type="number" min="1" value={amts[k] ?? amount} onChange={(e) => setAmts((a) => ({ ...a, [k]: e.target.value }))} placeholder="Amount" />
                  </div>
                </div>
              ))}
            </div>
            <Field label="Rent amount (per day, for newly selected dates)">
              <TextInput type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Enter amount" />
            </Field>
            <p className="text-sm">Total: <b>{inr(total)}</b> ({sel.length} day{sel.length === 1 ? "" : "s"})</p>
          </>
        )}
        <div className="flex justify-end gap-2 mt-2">
          <GhostBtn onClick={() => setOpen(false)}>Cancel</GhostBtn>
          <PrimaryBtn onClick={save} disabled={busy || loading || (!sel.length && !saved.length) || sel.some((d) => amtFor(toKey(d)) <= 0)}>{busy ? "Please wait..." : "Save"}</PrimaryBtn>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PaidLeaveDialog({ open, setOpen, driver, onDone }) {
  const [info, setInfo] = useState(null);
  const [sel, setSel] = useState([]);
  const [busy, setBusy] = useState(false);
  const toKey = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  const toDate = (s) => { const [y, m, dd] = s.split("-").map(Number); return new Date(y, m - 1, dd); };

  useEffect(() => {
    if (!open || !driver?.id) return;
    setInfo(null);
    api.get(`/drivers/${driver.id}/paid-leave`)
      .then(({ data }) => { setInfo(data); setSel(data.dates.filter((x) => x >= data.today).map(toDate)); })
      .catch((e) => { toast.error(e.response?.data?.detail || "Failed to load paid leave"); setOpen(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, driver?.id]);

  const todayStr = info?.today;
  const pastUsed = info ? info.dates.filter((x) => x < todayStr) : [];
  const maxPick = Infinity;  // no limit on the number of paid leave days
  const savedToday = info ? info.dates.includes(todayStr) : false;

  // Only today / future days of the current month; today only if its rent is not paid yet.
  const isDisabled = (day) => {
    if (!info || maxPick === 0) return true;
    const k = toKey(day);
    if (k < todayStr) return true;
    if (k === todayStr && info.today_rent_paid && !savedToday) return true;
    return false;
  };

  const save = async () => {
    setBusy(true);
    try {
      await api.post(`/drivers/${driver.id}/paid-leave`, { dates: sel.map(toKey).sort() });
      toast.success(sel.length ? "Paid leave saved" : "Paid leave cleared");
      onDone();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to save paid leave");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Paid Leave (Rent-free days)</DialogTitle></DialogHeader>
        {!info ? (
          <p className="text-sm text-mv-muted">Loading...</p>
        ) : (
          <>
            <p className="text-sm text-mv-muted">
              Select any number of days from today onwards. No daily rent will be asked from {driver?.name} on these days.
              {info.today_rent_paid ? " Today's rent is already paid, so today cannot be selected." : ""}
            </p>
            <div className="flex justify-center">
              <Calendar
                mode="multiple"
                selected={sel}
                onSelect={(v) => setSel(v || [])}
                disabled={isDisabled}
                defaultMonth={toDate(todayStr)}
                fromMonth={toDate(todayStr)}
                showOutsideDays={false}
                modifiers={{ used: pastUsed.map(toDate) }}
                modifiersClassNames={{ used: "bg-emerald-100 text-emerald-700 rounded-md" }}
              />
            </div>
            {pastUsed.length > 0 && <p className="text-xs text-mv-muted">Already used this month: {pastUsed.join(", ")}</p>}
            <div className="flex justify-end gap-2 mt-2">
              <GhostBtn onClick={() => setOpen(false)}>Cancel</GhostBtn>
              <PrimaryBtn onClick={save} disabled={busy}>{busy ? "Please wait..." : "Save Paid Leave"}</PrimaryBtn>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function BlockDriverDialog({ type, setType, driver, onDone }) {
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  useEffect(() => { setReason(""); }, [type]);
  const cfg = {
    temporary: { title: "Temporary Block", msg: `${driver?.name} will be temporarily blocked and cannot use the driver app until you unblock.`, btn: "Temporarily Block", cls: "bg-amber-500 hover:bg-amber-600 text-white" },
    permanent: { title: "Permanent Block", msg: `${driver?.name} will be permanently blocked from the driver app.`, btn: "Permanently Block", cls: "bg-red-500 hover:bg-red-600 text-white" },
    unblock: { title: "Unblock Driver", msg: `${driver?.name} will be able to use the driver app again.`, btn: "Unblock", cls: "bg-emerald-500 hover:bg-emerald-600 text-white" },
  }[type];

  const go = async () => {
    setBusy(true);
    try {
      if (type === "unblock") await api.post(`/drivers/${driver.id}/admin-unblock`);
      else {
        if (!reason.trim()) { toast.error("Please enter a reason"); setBusy(false); return; }
        await api.post(`/drivers/${driver.id}/admin-block`, { type, reason: reason.trim() });
      }
      toast.success(type === "unblock" ? "Driver unblocked" : "Driver blocked");
      onDone();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={!!type} onOpenChange={(o) => !o && setType(null)}>
      <DialogContent className="max-w-md">
        {cfg && (
          <>
            <DialogHeader><DialogTitle>{cfg.title}</DialogTitle></DialogHeader>
            <p className="text-sm text-mv-muted">{cfg.msg}</p>
            {type !== "unblock" && (
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
                placeholder="Reason for blocking (shown to driver)"
                className="w-full mt-3 p-3 rounded-xl border border-mv-border bg-mv-surface2 text-sm outline-none focus:ring-2 focus:ring-mv-primary/30" />
            )}
            <div className="flex justify-end gap-2 mt-4">
              <GhostBtn onClick={() => setType(null)}>Cancel</GhostBtn>
              <PrimaryBtn onClick={go} disabled={busy} className={cfg.cls}>{busy ? "Please wait..." : cfg.btn}</PrimaryBtn>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}