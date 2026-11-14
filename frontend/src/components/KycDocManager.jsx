import { useRef, useState } from "react";
import { Upload, Trash2, Eye, Loader2, FileText } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiErrorDetail } from "../lib/api";
import imgUrl from "../lib/imgUrl";

// Every KYC document type the admin can manage for a driver
export const KYC_DOC_TYPES = [
  { key: "dl_front", label: "Driving License (Front)" },
  { key: "dl_back", label: "Driving License (Back)" },
  { key: "aadhaar", label: "Aadhaar Card" },
  { key: "pan", label: "PAN Card" },
  { key: "driver_photo", label: "Driver Photo" },
  { key: "vehicle_photo", label: "Driver + Vehicle" },
  { key: "agreement", label: "Rental Agreement" },
];

const MAX_MB = 10;

export default function KycDocManager({ driverId, docs, onChanged }) {
  const [busy, setBusy] = useState(null);
  const [broken, setBroken] = useState({});   // urls that are not images (e.g. PDF) -> show "Open file"
  const inputs = useRef({});
  const base = `/admin/drivers/${driverId}/kyc`;

  const upload = async (key, file) => {
    if (!file) return;
    if (file.size > MAX_MB * 1024 * 1024) return toast.error(`File must be under ${MAX_MB} MB`);
    setBusy(key);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post(`${base}/${key}`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Document uploaded");
      onChanged && onChanged(data.kyc_documents || {});
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    } finally {
      setBusy(null);
      if (inputs.current[key]) inputs.current[key].value = "";
    }
  };

  const remove = async (key, label) => {
    if (!window.confirm(`Delete "${label}"?`)) return;
    setBusy(key);
    try {
      const { data } = await api.delete(`${base}/${key}`);
      toast.success("Document deleted");
      onChanged && onChanged(data.kyc_documents || {});
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6" data-testid="kyc-doc-manager">
      {KYC_DOC_TYPES.map(({ key, label }) => {
        const url = docs?.[key];
        const full = url ? imgUrl(url) : null;
        const isBusy = busy === key;
        return (
          <div key={key} className="space-y-2">
            <h4 className="font-semibold text-slate-700 text-sm">{label}</h4>
            <div className="aspect-video bg-slate-100 rounded-2xl overflow-hidden relative flex items-center justify-center">
              {full && !broken[full] ? (
                <img
                  src={full}
                  alt={label}
                  className="w-full h-full object-contain bg-black cursor-pointer"
                  onClick={() => window.open(full, "_blank")}
                  onError={() => setBroken((b) => ({ ...b, [full]: true }))}
                />
              ) : full ? (
                <a href={full} target="_blank" rel="noreferrer" className="flex flex-col items-center gap-1 text-slate-600 text-sm">
                  <FileText className="w-8 h-8" /> Open file
                </a>
              ) : (
                <span className="text-slate-400 text-sm">Not Provided</span>
              )}
              {isBusy && (
                <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 animate-spin text-red-500" />
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                ref={(el) => { inputs.current[key] = el; }}
                onChange={(e) => upload(key, e.target.files?.[0])}
              />
              <button
                type="button"
                disabled={isBusy}
                onClick={() => inputs.current[key]?.click()}
                className="flex-1 h-9 inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold disabled:opacity-50"
              >
                <Upload className="w-3.5 h-3.5" /> {url ? "Replace" : "Upload"}
              </button>
              {url && (
                <>
                  <a
                    href={full}
                    target="_blank"
                    rel="noreferrer"
                    className="h-9 px-3 inline-flex items-center justify-center rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700"
                    title="View"
                  >
                    <Eye className="w-4 h-4" />
                  </a>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => remove(key, label)}
                    className="h-9 px-3 inline-flex items-center justify-center rounded-xl border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
