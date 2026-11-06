import { useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, Loader2 } from "lucide-react";
import { useNativeCamera } from "../../hooks/useNativeCamera";
import { toast } from "sonner";
import PayModal from "./PayModal";
import dapi from "../../lib/driverApi";
import { inr } from "../../lib/format";

// "Pay commission amount" / "Pay salary amount" popup for Commission / Salary package drivers.
// Before 12:00 noon (IST) it has an X close button; from noon it stays until the amount is paid.
export default function PackageCollectionPopup({ due, driver, refresh }) {
  const [dismissed, setDismissed] = useState(null);   // date the driver closed (X) before noon
  const [paidOpen, setPaidOpen] = useState(false);    // keeps the popup open for the "Payment Confirmed" screen
  const [file, setFile] = useState(null);
  const [total, setTotal] = useState("");
  const last = useRef(null);
  const { captureImage, loading: picking } = useNativeCamera();   // same picker as the KYC documents

  if (due) last.current = due;
  const d = due || (paidOpen ? last.current : null);

  // new due day -> start with empty fields
  useEffect(() => { setFile(null); setTotal(""); }, [d?.date]);
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);

  if (!d) return null;

  const isCommission = d.category === "commission";
  const pct = Number(d.commission_percent || 0);
  const totalNum = Number(total) || 0;
  const payAmount = isCommission ? Math.round(totalNum * pct) / 100 : totalNum;
  const open = paidOpen || !!(due && (due.locked || dismissed !== due.date));

  // one field: on mobile it opens the KYC-style chooser (Upload Image / Take Photo); on the browser it opens the file chooser
  const pick = async () => {
    const f = await captureImage();
    if (f) setFile(f);
  };

  const createOrder = async () => {
    const fd = new FormData();
    fd.append("image", file);
    fd.append("total_collected", String(totalNum));
    fd.append("for_date", d.date);
    const { data } = await dapi.post("/driver/package-collection/create-order", fd);
    return data;
  };

  const onClose = () => {
    if (paidOpen) { setPaidOpen(false); setFile(null); setTotal(""); refresh && refresh(); }
    else setDismissed(d.date);
  };

  const btn = "flex-1 h-11 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 flex items-center justify-center gap-2 hover:bg-slate-50";
  const ready = !!file && totalNum > 0 && payAmount > 0 && (!isCommission || pct > 0);

  return (
    <PayModal
      open={open}
      onClose={onClose}
      kind={isCommission ? "package_commission" : "package_salary"}
      title={isCommission ? "Pay commission amount" : "Pay salary amount"}
      amount={payAmount}
      lines={[{ label: "Package", value: d.plan_name || (isCommission ? "Commission Package" : "Salary Package") }, { label: "For date", value: d.date }]}
      driverName={driver?.name}
      driverPhone={driver?.phone}
      dismissible={!d.locked}
      allowZero
      createOrderFn={createOrder}
      payDisabled={!ready}
      onDone={() => setPaidOpen(true)}
    >
      <div className="mt-4 space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Trip Screenshot *</label>
          {preview && <img src={preview} alt="Screenshot preview" className="w-full h-32 object-cover rounded-xl border border-slate-200 mb-2" />}
          <button type="button" onClick={pick} disabled={picking} className={`${btn} w-full`} data-testid="pkg-upload-image">
            {picking ? <><Loader2 className="w-4 h-4 animate-spin" /> Opening…</> : <><ImagePlus className="w-4 h-4" /> {file ? "Change Image" : "Upload Image"}</>}
          </button>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Total Amount Collected (₹) *</label>
          <input type="number" inputMode="decimal" min="0" value={total} onChange={(e) => setTotal(e.target.value)}
            placeholder="Enter amount"
            className="w-full h-11 rounded-xl border border-slate-200 px-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500" />
        </div>

        {isCommission && (
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Commission ({pct}%) *</label>
            <input type="text" readOnly value={totalNum > 0 ? inr(payAmount) : ""} placeholder="Calculated automatically"
              className="w-full h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-800" />
          </div>
        )}
      </div>
    </PayModal>
  );
}