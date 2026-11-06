import { useEffect, useRef, useState } from "react";
import api from "../lib/api";
import { Field, TextInput } from "./common/Page";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

const NONE = "__none__";
const RENTAL_STATES = [
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
  { value: "pending_payment", label: "Pending Payment" },
  { value: "closed", label: "Closed" },
];
const todayIST = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

// Packages that must NOT be offered for a given city (compared case-insensitively, ignoring spaces/hyphens)
// Matches "In-Build Vehicles", "In-Built Vehicles", "inbuilt vehicle", etc.
const isBlockedPackage = (city, planName) =>
  city === "Bangalore" && /^in[\s\-_]*buil[dt][\s\-_]*vehicles?$/i.test(String(planName || "").trim());

// Returns an error message, or "" when OK. Call it inside the form's save().
export const validateAssign = (form) => {
  if (form.vehicle_id && !form.package_id) return "Select a package for the assigned vehicle";
  if (form.package_id && !form.rental_start) return "Select the rental start date";
  if (form.package_id && !form.rental_state) return "Select the rental status";
  if (form.rental_state && !form.vehicle_id) return "Select a vehicle to set the rental status";
  if (form.rental_end && form.rental_start && form.rental_end < form.rental_start) return "End date cannot be before start date";
  return "";
};

// city = the driver's city, form/set = the parent form state, assigned = driver already has a rental (edit only)
export default function DriverAssignFields({ city, form, set, assigned, withPackageType = false }) {
  const [vehicles, setVehicles] = useState([]);
  const [plans, setPlans] = useState([]);
  const [managers, setManagers] = useState([]);
  const prevCity = useRef(city);

  useEffect(() => {
    // city changed in the Add form: old selections are no longer valid
    if (prevCity.current && prevCity.current !== city) {
      set("vehicle_id", ""); set("package_id", ""); set("rental_start", ""); set("rental_end", ""); set("supervisor_id", ""); set("rental_state", ""); if (withPackageType) set("package_category", "");
    }
    prevCity.current = city;
    if (!city) { setVehicles([]); setPlans([]); setManagers([]); return; }
    let live = true;
    api.get("/vehicles", { params: { status: "available", city, page_size: 500 } })
      .then((r) => live && setVehicles(r.data.items || [])).catch(() => live && setVehicles([]));
    api.get("/rental-plans")
      .then((r) => live && setPlans((r.data || []).filter((p) => p.city === city && p.active !== false && !isBlockedPackage(city, p.name)))).catch(() => live && setPlans([]));
    api.get("/users")
      .then((r) => live && setManagers((r.data || []).filter((u) => u.role === "city_manager" && u.city === city))).catch(() => live && setManagers([]));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city]);

  const pickVehicle = (v) => {
    const val = v === NONE ? "" : v;
    set("vehicle_id", val);
    if (!val) { set("package_id", ""); set("rental_start", ""); set("rental_end", ""); set("rental_state", ""); if (withPackageType) set("package_category", ""); }
  };
  const planKind = (p) => (p.package_type === "Commission" ? "commission" : p.package_type === "Salary" ? "salary" : "rental");
  const shownPlans = plans.filter((p) => planKind(p) === (withPackageType ? form.package_category : "rental"));
  const planLabel = (p) =>
    planKind(p) === "commission" ? `${p.name} · ${p.commission_percent ?? "—"}%`
    : planKind(p) === "salary" ? `${p.name} · ₹${p.salary_amount ?? "—"}`
    : `${p.name} · ₹${p.amount}/day`;
  const pickPackageCategory = (v) => {
    set("package_category", v === NONE ? "" : v);
    set("package_id", ""); // package list changes with the type
    set("rental_state", ""); // status field is hidden until a package is picked again
  };

  const pickPackage = (v) => {
    set("package_id", v);
    if (!form.rental_start) set("rental_start", todayIST());
    if (!form.rental_state) set("rental_state", "active");
  };

  return (
    <>
      {assigned ? (
        <div className="col-span-2 rounded-xl border border-mv-border p-3">
          <div className="text-sm font-semibold mb-3">
            Current Rental{assigned.code ? ` · ${assigned.code}` : ""}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Vehicle">
              <Select value={form.vehicle_id || NONE} onValueChange={(v) => set("vehicle_id", v === NONE ? "" : v)} disabled={!city}>
                <SelectTrigger className="h-10 bg-mv-surface2 border-mv-border"><SelectValue placeholder="Select vehicle" /></SelectTrigger>
                <SelectContent className="bg-mv-surface border-mv-border text-mv-text max-h-64">
                  <SelectItem value={NONE}>{assigned.vehicle || "—"} (current)</SelectItem>
                  {vehicles.map((v) => (
                    <SelectItem key={v.id} value={v.id}>{v.vehicle_number}{v.registration_number ? ` · ${v.registration_number}` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Package">
              <TextInput value={assigned.package || "—"} readOnly disabled />
            </Field>
            <Field label="Start Date">
              <TextInput value={assigned.start ? String(assigned.start).slice(0, 10) : "—"} readOnly disabled />
            </Field>
            <Field label="End Date">
              <TextInput value={assigned.end && assigned.end !== "Ongoing" ? String(assigned.end).slice(0, 10) : "Ongoing"} readOnly disabled />
            </Field>
            <div className="col-span-2">
              <Field label="Rental Status">
                {assigned.hasRental ? (
                  <Select value={form.rental_state || assigned.state || undefined} onValueChange={(v) => set("rental_state", v)}>
                    <SelectTrigger className="h-10 bg-mv-surface2 border-mv-border"><SelectValue placeholder="Select status" /></SelectTrigger>
                    <SelectContent className="bg-mv-surface border-mv-border text-mv-text">
                      {RENTAL_STATES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <TextInput value={assigned.state || "—"} readOnly disabled />
                )}
              </Field>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="col-span-2">
            <Field label="Vehicle Assigned (optional)">
              <Select value={form.vehicle_id || NONE} onValueChange={pickVehicle} disabled={!city}>
                <SelectTrigger className="h-10 bg-mv-surface2 border-mv-border"><SelectValue placeholder={city ? "Select vehicle" : "Select city first"} /></SelectTrigger>
                <SelectContent className="bg-mv-surface border-mv-border text-mv-text max-h-64">
                  <SelectItem value={NONE}>— None —</SelectItem>
                  {vehicles.map((v) => (
                    <SelectItem key={v.id} value={v.id}>{v.vehicle_number}{v.registration_number ? ` · ${v.registration_number}` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          {form.vehicle_id && withPackageType && (
            <div className="col-span-2">
              <Field label="Select Package Type">
                <Select value={form.package_category || NONE} onValueChange={pickPackageCategory}>
                  <SelectTrigger className="h-10 bg-mv-surface2 border-mv-border"><SelectValue placeholder="Select package type" /></SelectTrigger>
                  <SelectContent className="bg-mv-surface border-mv-border text-mv-text">
                    <SelectItem value={NONE}>— None —</SelectItem>
                    <SelectItem value="rental">Rental Package</SelectItem>
                    <SelectItem value="commission">Commission Package</SelectItem>
                    <SelectItem value="salary">Salary Package</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
          )}

          {form.vehicle_id && (!withPackageType || form.package_category) && (
            <div className="col-span-2">
              <Field label="Select Package *">
                <Select value={form.package_id || undefined} onValueChange={pickPackage}>
                  <SelectTrigger className="h-10 bg-mv-surface2 border-mv-border"><SelectValue placeholder="Select package" /></SelectTrigger>
                  <SelectContent className="bg-mv-surface border-mv-border text-mv-text max-h-64">
                    {shownPlans.length === 0 && <div className="px-3 py-2 text-xs text-mv-muted">No packages for {city}</div>}
                    {shownPlans.map((p) => <SelectItem key={p.id} value={p.id}>{planLabel(p)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          )}

          {form.vehicle_id && form.package_id && (
            <div className="col-span-2 rounded-xl border border-mv-border p-3">
              <div className="text-sm font-semibold">Rental Dates</div>
              <p className="text-xs text-mv-muted mb-3">Set start date and optional end date (leave blank for Ongoing).</p>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Start Date *">
                  <TextInput type="date" value={form.rental_start || ""} onChange={(e) => set("rental_start", e.target.value)} />
                </Field>
                <Field label="End Date">
                  <TextInput type="date" min={form.rental_start || undefined} value={form.rental_end || ""} onChange={(e) => set("rental_end", e.target.value)} />
                </Field>
              </div>
            </div>
          )}
        </>
      )}

      <div className="col-span-2">
        {!assigned && (!withPackageType || form.package_id) && (
          <div className="mb-4">
            <Field label={`Rental Status${form.package_id ? " *" : " (optional)"}`}>
              <Select value={form.rental_state || (form.package_id ? undefined : NONE)} onValueChange={(v) => set("rental_state", v === NONE ? "" : v)}>
                <SelectTrigger className="h-10 bg-mv-surface2 border-mv-border"><SelectValue placeholder="Select status" /></SelectTrigger>
                <SelectContent className="bg-mv-surface border-mv-border text-mv-text">
                  {!form.package_id && <SelectItem value={NONE}>— None —</SelectItem>}
                  {RENTAL_STATES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>
        )}
        <Field label="Supervisor (optional)">
          <Select value={form.supervisor_id || NONE} onValueChange={(v) => set("supervisor_id", v === NONE ? "" : v)} disabled={!city}>
            <SelectTrigger className="h-10 bg-mv-surface2 border-mv-border"><SelectValue placeholder="Select supervisor" /></SelectTrigger>
            <SelectContent className="bg-mv-surface border-mv-border text-mv-text max-h-64">
              <SelectItem value={NONE}>— None —</SelectItem>
              {managers.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
      </div>
    </>
  );
}