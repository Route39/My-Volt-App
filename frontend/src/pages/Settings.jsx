import { useEffect, useState } from "react";
import { Plus, MapPin, Phone, AtSign, MoreVertical, Edit2, Trash2, Loader2, Lock, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import api from "../lib/api";
import { useAuth, roleLabel } from "../context/AuthContext";
import { CITIES } from "../context/AppContext";
import { Skeleton } from "../components/common/Primitives";
import { PrimaryBtn, Field, TextInput } from "../components/common/Page";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Avatar, AvatarFallback } from "../components/ui/avatar";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "../components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";

const ROLES = ["admin", "city_manager"];

export default function Settings() {
  const { user } = useAuth();
  const [users, setUsers] = useState(null);
  const [editingUser, setEditingUser] = useState(null);
  const [showForm, setShowForm] = useState(false);
  
  const load = () => api.get("/users").then((r) => setUsers(r.data)).catch(() => setUsers([]));
  useEffect(() => { load(); }, []);

  const getAvatarColor = (name) => {
    const colors = ["bg-amber-500", "bg-emerald-500", "bg-indigo-500", "bg-blue-500", "bg-rose-500", "bg-violet-500"];
    let hash = 0;
    for (let i = 0; i < (name || "").length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  };

  const handleEdit = (u) => { setEditingUser(u); setShowForm(true); };
  const handleDelete = async (uid) => {
    if (!window.confirm("Are you sure you want to delete this user?")) return;
    try { await api.delete(`/users/${uid}`); toast.success("User deleted"); load(); }
    catch (e) { toast.error(e.response?.data?.detail || "Failed to delete"); }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Settings</h1>
        <p className="text-slate-500 mt-1">Manage your team and security settings</p>
      </div>

      <Tabs defaultValue="team">
        <TabsList className="bg-mv-surface border border-mv-border mb-6">
          <TabsTrigger value="team" className="data-[state=active]:bg-mv-elevated">Team</TabsTrigger>
          <TabsTrigger value="pkg-password" className="data-[state=active]:bg-mv-elevated">Package Password</TabsTrigger>
        </TabsList>

        <TabsContent value="team">
          <div className="flex justify-end mb-6">
            {user?.role === "admin" && (
              <PrimaryBtn onClick={() => { setEditingUser(null); setShowForm(true); }} className="rounded-full shadow-md bg-indigo-600 hover:bg-indigo-700 h-10 px-5">
                <Plus className="w-4 h-4 mr-1" /> Add Team Member
              </PrimaryBtn>
            )}
          </div>

          {!users && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-3xl" />)}
            </div>
          )}

          {users && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {users.map((u) => (
                <div key={u.id} className="bg-white rounded-[1.5rem] p-6 shadow-[0_2px_12px_rgb(0,0,0,0.04)] border border-slate-100 flex flex-col justify-between relative group">
                  {user?.role === "admin" && (
                    <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                      <DropdownMenu>
                        <DropdownMenuTrigger className="p-1 rounded-md hover:bg-slate-100">
                          <MoreVertical className="w-4 h-4 text-slate-400" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleEdit(u)} className="cursor-pointer text-sm">
                            <Edit2 className="w-3.5 h-3.5 mr-2 text-indigo-500" /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleDelete(u.id)} className="cursor-pointer text-sm text-red-600">
                            <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}
                  <div className="flex items-start gap-4">
                    <Avatar className="w-14 h-14 rounded-full shadow-sm">
                      <AvatarFallback className={`${getAvatarColor(u.name)} text-white font-bold text-lg`}>
                        {(u.name || "U")[0].toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0 pr-6">
                      <h3 className="font-extrabold text-slate-900 text-lg truncate uppercase tracking-tight">{u.name}</h3>
                      <p className="text-slate-400 text-xs font-medium capitalize mt-0.5">{roleLabel(u.role)}</p>
                    </div>
                  </div>
                  <div className="mt-6 space-y-2">
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                      <Phone className="w-4 h-4 text-slate-400" />
                      <span className="font-medium">{u.phone || "No phone"}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                      <AtSign className="w-4 h-4 text-slate-400" />
                      <span className="font-medium truncate">{u.email}</span>
                    </div>
                    {u.city && (
                      <div className="flex items-center gap-2 text-sm text-slate-600">
                        <MapPin className="w-4 h-4 text-slate-400" />
                        <span className="font-medium">{u.city}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="pkg-password">
          <PackagePasswordTab />
        </TabsContent>
      </Tabs>

      <UserDialog open={showForm} setOpen={setShowForm} editUser={editingUser} onDone={() => { setShowForm(false); load(); }} />
    </div>
  );
}

function UserDialog({ open, setOpen, editUser, onDone }) {
  const [form, setForm] = useState({ name: "", phone: "", email: "", password: "", role: "city_manager", city: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editUser && open) {
      setForm({
        name: editUser.name || "",
        phone: editUser.phone || "",
        email: editUser.email || "",
        password: "", 
        role: editUser.role || "city_manager",
        city: editUser.city || ""
      });
    } else if (!editUser && open) {
      setForm({ name: "", phone: "", email: "", password: "", role: "city_manager", city: "" });
    }
  }, [editUser, open]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  
  const save = async () => {
    if (!form.name || !form.phone || !form.email) { 
      toast.error("Name, phone, and username are required"); 
      return; 
    }
    if (!editUser && !form.password) {
      toast.error("Password is required for new users"); 
      return; 
    }
    
    setSaving(true);
    try { 
      const payload = { ...form, city: form.role === "city_manager" ? form.city : null };
      if (editUser && !form.password) delete payload.password;

      if (editUser) {
        await api.put(`/users/${editUser.id}`, payload);
        toast.success("Member updated ✓"); 
      } else {
        await api.post("/users", payload);
        toast.success("Member added ✓"); 
      }
      onDone(); 
    } catch (e) { 
      toast.error(e.response?.data?.detail || "Failed to save user"); 
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-mv-surface border-mv-border text-mv-text max-w-md">
        <DialogHeader><DialogTitle className="font-display font-extrabold text-xl">{editUser ? "Edit" : "Add"} Team Member</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4">
          <Field label="Name"><TextInput value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Full Name" /></Field>
          <Field label="Phone Number"><TextInput type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="10-digit number" /></Field>
          <Field label="Username"><TextInput type="text" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="Choose a username" /></Field>
          <Field label="Password"><TextInput type="password" value={form.password} onChange={(e) => set("password", e.target.value)} placeholder={editUser ? "Leave blank to keep" : "Set password"} /></Field>
          <Field label="Role">
            <Select value={form.role} onValueChange={(v) => set("role", v)}>
              <SelectTrigger className="h-11 rounded-xl bg-mv-surface2 border-mv-border"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-mv-surface border-mv-border text-mv-text">
                {ROLES.map((r) => <SelectItem key={r} value={r}>{roleLabel(r)}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          {form.role === "city_manager" && (
            <Field label="City">
              <Select value={form.city} onValueChange={(v) => set("city", v)}>
                <SelectTrigger className="h-11 rounded-xl bg-mv-surface2 border-mv-border"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent className="bg-mv-surface border-mv-border text-mv-text">
                  {CITIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          )}
        </div>
        <div className="flex justify-end pt-4">
          <PrimaryBtn onClick={save} disabled={saving} data-testid="save-user-btn" className="w-full sm:w-auto px-8 shadow-md h-11 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">
            {saving ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : (editUser ? "Save Changes" : "Add Member")}
          </PrimaryBtn>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PackagePasswordTab() {
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!newPwd) { toast.error("Enter a new password"); return; }
    if (newPwd !== confirmPwd) { toast.error("Passwords do not match"); return; }
    setSaving(true);
    try {
      await api.post("/settings/package-password", { password: newPwd });
      toast.success("Package password updated ✓");
      setNewPwd("");
      setConfirmPwd("");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to update");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-md">
      <div className="bg-white rounded-3xl border border-slate-100 shadow-[0_2px_12px_rgb(0,0,0,0.04)] p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center">
            <Lock className="w-6 h-6 text-indigo-600" />
          </div>
          <div>
            <h2 className="font-extrabold text-slate-900 text-lg">Package Password</h2>
            <p className="text-slate-500 text-sm">Required to open Rental Packages page. Auto-locks after 10 min.</p>
          </div>
        </div>

        <div className="space-y-4">
          <Field label="New Password">
            <div className="relative">
              <TextInput
                type={showNew ? "text" : "password"}
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                placeholder="Enter new password"
              />
              <button type="button" onClick={() => setShowNew(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </Field>
          <Field label="Confirm Password">
            <div className="relative">
              <TextInput
                type={showConfirm ? "text" : "password"}
                value={confirmPwd}
                onChange={(e) => setConfirmPwd(e.target.value)}
                placeholder="Re-enter password"
                onKeyDown={(e) => e.key === "Enter" && save()}
              />
              <button type="button" onClick={() => setShowConfirm(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </Field>
        </div>

        <div className="mt-6">
          <PrimaryBtn onClick={save} disabled={saving} className="w-full h-11 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">
            {saving ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : "Update Password"}
          </PrimaryBtn>
        </div>
      </div>
    </div>
  );
}
