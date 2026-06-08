"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { formatDateTime, timeAgo } from "@/lib/utils";
import {
  Users,
  ShieldCheck,
  ScrollText,
  Plus,
  Pencil,
  Trash2,
  Search,
  Check,
  X,
  RefreshCw,
  ChevronDown,
} from "lucide-react";
import { toast } from "sonner";

type SystemRole = "owner" | "manager" | "receptionist" | "trainer" | "viewer";

interface SystemUser {
  id: string;
  email: string;
  full_name: string;
  role: SystemRole;
  status: "active" | "inactive";
  last_active_at: string | null;
  created_at: string;
  staff_id: string | null;
}

interface ActivityLog {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  description: string;
  created_at: string;
  system_users: { full_name: string; email: string } | { full_name: string; email: string }[] | null;
}

interface StaffMember {
  id: string;
  full_name: string;
  role: string;
}

interface Props {
  currentUserId: string;
  staffMembers: StaffMember[];
}

const ROLE_LABELS: Record<SystemRole, string> = {
  owner:        "Owner",
  manager:      "Manager",
  receptionist: "Receptionist",
  trainer:      "Trainer",
  viewer:       "Viewer",
};

const ROLE_COLORS: Record<SystemRole, string> = {
  owner:        "bg-purple-50 text-purple-700 border-purple-200",
  manager:      "bg-blue-50 text-blue-700 border-blue-200",
  receptionist: "bg-green-50 text-green-700 border-green-200",
  trainer:      "bg-orange-50 text-orange-700 border-orange-200",
  viewer:       "bg-gray-100 text-gray-600 border-gray-200",
};

const PERMISSION_MATRIX: { feature: string; owner: boolean; manager: boolean; receptionist: boolean; trainer: boolean; viewer: boolean }[] = [
  { feature: "Dashboard",            owner: true,  manager: true,  receptionist: true,  trainer: false, viewer: true  },
  { feature: "Members (view)",       owner: true,  manager: true,  receptionist: true,  trainer: false, viewer: true  },
  { feature: "Members (add/edit)",   owner: true,  manager: true,  receptionist: true,  trainer: false, viewer: false },
  { feature: "Submissions (view)",   owner: true,  manager: true,  receptionist: true,  trainer: false, viewer: false },
  { feature: "Submissions (approve)",owner: true,  manager: true,  receptionist: false, trainer: false, viewer: false },
  { feature: "Attendance",           owner: true,  manager: true,  receptionist: true,  trainer: true,  viewer: false },
  { feature: "Fees & Payments",      owner: true,  manager: true,  receptionist: true,  trainer: false, viewer: false },
  { feature: "Packages",             owner: true,  manager: true,  receptionist: false, trainer: false, viewer: false },
  { feature: "Staff & Trainers",     owner: true,  manager: true,  receptionist: false, trainer: false, viewer: false },
  { feature: "Reports",              owner: true,  manager: true,  receptionist: false, trainer: false, viewer: false },
  { feature: "SMS & Notifications",  owner: true,  manager: true,  receptionist: true,  trainer: false, viewer: false },
  { feature: "Settings",             owner: true,  manager: false, receptionist: false, trainer: false, viewer: false },
];

const ACTION_TYPES = [
  "added_member", "approved_submission", "rejected_submission",
  "paid_fee", "added_expense", "added_staff", "added_system_user",
  "deleted_system_user", "attendance_push",
];

type Tab = "users" | "permissions" | "logs";

export function SettingsClient({ currentUserId, staffMembers }: Props) {
  const [tab, setTab] = useState<Tab>("users");

  // ── Users tab state ──
  const [users, setUsers] = useState<SystemUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [userSearch, setUserSearch] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [editUser, setEditUser] = useState<SystemUser | null>(null);
  const [deleteUser, setDeleteUser] = useState<SystemUser | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Add form
  const [addForm, setAddForm] = useState({ email: "", password: "", full_name: "", role: "receptionist" as SystemRole, staff_id: "" });
  const [addErrors, setAddErrors] = useState<Record<string, string>>({});

  // Edit form
  const [editForm, setEditForm] = useState({ full_name: "", role: "receptionist" as SystemRole, status: "active" as "active" | "inactive" });

  // ── Logs tab state ──
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logSearch, setLogSearch] = useState("");
  const [logUser, setLogUser] = useState("");
  const [logAction, setLogAction] = useState("");
  const [logFrom, setLogFrom] = useState("");
  const [logTo, setLogTo] = useState("");
  const [logOffset, setLogOffset] = useState(0);
  const [logTotal, setLogTotal] = useState(0);
  const LOG_PAGE = 50;

  const supabase = createClient();

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    const { data } = await supabase
      .from("system_users")
      .select("id, email, full_name, role, status, last_active_at, created_at, staff_id")
      .is("deleted_at", null)
      .order("created_at");
    setUsers(data ?? []);
    setUsersLoading(false);
  }, []);

  const loadLogs = useCallback(async (offset = 0) => {
    setLogsLoading(true);
    let query = supabase
      .from("activity_logs")
      .select("id, action, entity_type, entity_id, description, created_at, system_users(full_name, email)", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + LOG_PAGE - 1);

    if (logSearch) query = query.ilike("description", `%${logSearch}%`);
    if (logUser)   query = query.eq("user_id", logUser);
    if (logAction) query = query.eq("action", logAction);
    if (logFrom)   query = query.gte("created_at", logFrom);
    if (logTo)     query = query.lte("created_at", logTo + "T23:59:59");

    const { data, count } = await query;
    setLogs(data ?? []);
    setLogTotal(count ?? 0);
    setLogOffset(offset);
    setLogsLoading(false);
  }, [logSearch, logUser, logAction, logFrom, logTo]);

  useEffect(() => { loadUsers(); }, [loadUsers]);
  useEffect(() => { if (tab === "logs") loadLogs(0); }, [tab, loadLogs]);

  // ── Computed ──
  const filteredUsers = users.filter((u) => {
    const q = userSearch.toLowerCase();
    return !q || u.full_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
  });
  const activeCount = users.filter((u) => u.status === "active").length;

  // ── Add user ──
  function validateAdd() {
    const errs: Record<string, string> = {};
    if (!addForm.full_name.trim()) errs.full_name = "Required";
    if (!addForm.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addForm.email)) errs.email = "Valid email required";
    if (addForm.password.length < 8) errs.password = "Min 8 characters";
    if (!addForm.role) errs.role = "Required";
    setAddErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleAddUser() {
    if (!validateAdd()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/create-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: addForm.email,
          password: addForm.password,
          full_name: addForm.full_name,
          role: addForm.role,
          staff_id: addForm.staff_id || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) { toast.error(json.error); return; }
      toast.success(`${addForm.full_name} added successfully`);
      setShowAddModal(false);
      setAddForm({ email: "", password: "", full_name: "", role: "receptionist", staff_id: "" });
      loadUsers();
    } finally {
      setSubmitting(false);
    }
  }

  // ── Edit user ──
  function openEdit(u: SystemUser) {
    setEditUser(u);
    setEditForm({ full_name: u.full_name, role: u.role, status: u.status });
  }

  async function handleEditUser() {
    if (!editUser) return;
    setSubmitting(true);
    const { error } = await supabase
      .from("system_users")
      .update({ full_name: editForm.full_name, role: editForm.role, status: editForm.status, updated_at: new Date().toISOString() })
      .eq("id", editUser.id);

    if (error) { toast.error(error.message); setSubmitting(false); return; }

    await supabase.from("activity_logs").insert({
      user_id: currentUserId,
      action: "edited_system_user",
      entity_type: "system_user",
      entity_id: editUser.id,
      description: `Updated user ${editForm.full_name} — role: ${editForm.role}, status: ${editForm.status}`,
    });

    toast.success("User updated");
    setEditUser(null);
    setSubmitting(false);
    loadUsers();
  }

  // ── Delete user ──
  async function handleDeleteUser() {
    if (!deleteUser) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/delete-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: deleteUser.id, userName: deleteUser.full_name }),
      });
      const json = await res.json();
      if (!res.ok) { toast.error(json.error); return; }
      toast.success(`${deleteUser.full_name} deleted`);
      setDeleteUser(null);
      loadUsers();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex-1 p-6 space-y-6 overflow-auto">
      {/* Tabs */}
      <div className="flex gap-1 bg-[#F8F8F6] border border-[#E4E4DE] rounded-xl p-1 w-fit">
        {(["users", "permissions", "logs"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === t
                ? "bg-white text-[#1A1A16] shadow-sm border border-[#E4E4DE]"
                : "text-[#7A7A72] hover:text-[#1A1A16]"
            }`}
          >
            {t === "users" && <Users className="w-4 h-4" />}
            {t === "permissions" && <ShieldCheck className="w-4 h-4" />}
            {t === "logs" && <ScrollText className="w-4 h-4" />}
            {t === "users" ? "Users" : t === "permissions" ? "Roles & Permissions" : "Activity Logs"}
          </button>
        ))}
      </div>

      {/* ═══ USERS TAB ═══ */}
      {tab === "users" && (
        <div className="space-y-5">
          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Total Users", value: users.length, color: "text-[#1A1A16]" },
              { label: "Active", value: activeCount, color: "text-green-600" },
              { label: "Inactive", value: users.length - activeCount, color: "text-[#7A7A72]" },
              { label: "Roles", value: [...new Set(users.map((u) => u.role))].length, color: "text-[#F06418]" },
            ].map((s) => (
              <div key={s.label} className="bg-white border border-[#E4E4DE] rounded-xl p-4">
                <p className="text-xs text-[#7A7A72] font-medium">{s.label}</p>
                <p className={`text-2xl font-bold mt-0.5 font-[family-name:var(--font-barlow-condensed)] ${s.color}`}>
                  {s.value}
                </p>
              </div>
            ))}
          </div>

          {/* Filter + Add */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#7A7A72]" />
              <input
                className="w-full pl-9 pr-3 py-2 text-sm border border-[#E4E4DE] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418]"
                placeholder="Search users..."
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
              />
            </div>
            <Button onClick={() => setShowAddModal(true)} size="sm">
              <Plus className="w-4 h-4 mr-1.5" /> Add User
            </Button>
          </div>

          {/* Table */}
          <div className="bg-white border border-[#E4E4DE] rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#F8F8F6] border-b border-[#E4E4DE]">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[#7A7A72] uppercase tracking-wide">User</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[#7A7A72] uppercase tracking-wide">Role</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[#7A7A72] uppercase tracking-wide hidden sm:table-cell">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[#7A7A72] uppercase tracking-wide hidden md:table-cell">Last Active</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E4E4DE]">
                {usersLoading ? (
                  [...Array(3)].map((_, i) => (
                    <tr key={i}>
                      <td colSpan={5} className="px-4 py-4">
                        <div className="h-5 bg-gray-100 animate-pulse rounded w-3/4" />
                      </td>
                    </tr>
                  ))
                ) : filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-[#7A7A72]">
                      No users found
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((u) => (
                    <tr key={u.id} className="hover:bg-[#F8F8F6] transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-[#FEF0E8] flex items-center justify-center flex-shrink-0">
                            <span className="text-[#F06418] text-xs font-bold">
                              {u.full_name.charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <div>
                            <p className="font-medium text-[#1A1A16]">
                              {u.full_name}
                              {u.id === currentUserId && (
                                <span className="ml-1.5 text-[10px] text-[#7A7A72]">(you)</span>
                              )}
                            </p>
                            <p className="text-xs text-[#7A7A72]">{u.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${ROLE_COLORS[u.role]}`}>
                          {ROLE_LABELS[u.role]}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <Badge variant={u.status === "active" ? "active" : "inactive"}>
                          {u.status === "active" ? "Active" : "Inactive"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-xs text-[#7A7A72] hidden md:table-cell">
                        {u.last_active_at ? timeAgo(u.last_active_at) : "Never"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openEdit(u)}
                            className="p-1.5 rounded-lg text-[#7A7A72] hover:bg-[#FEF0E8] hover:text-[#F06418] transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          {u.id !== currentUserId && (
                            <button
                              onClick={() => setDeleteUser(u)}
                              className="p-1.5 rounded-lg text-[#7A7A72] hover:bg-red-50 hover:text-red-600 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ PERMISSIONS TAB ═══ */}
      {tab === "permissions" && (
        <div className="space-y-4">
          <div className="bg-[#FEF0E8] border border-[#FDDCC8] rounded-xl px-4 py-3 text-sm text-[#C04E10]">
            Permissions are role-based. To change what a user can access, update their role in the <strong>Users</strong> tab.
          </div>
          <div className="bg-white border border-[#E4E4DE] rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#1A1A1A]">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-white/60 uppercase tracking-wide">Feature</th>
                  {(["owner", "manager", "receptionist", "trainer", "viewer"] as SystemRole[]).map((r) => (
                    <th key={r} className="text-center px-3 py-3 text-xs font-semibold uppercase tracking-wide">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${ROLE_COLORS[r]}`}>
                        {ROLE_LABELS[r]}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E4E4DE]">
                {PERMISSION_MATRIX.map((row) => (
                  <tr key={row.feature} className="hover:bg-[#F8F8F6]">
                    <td className="px-4 py-3 font-medium text-[#1A1A16]">{row.feature}</td>
                    {(["owner", "manager", "receptionist", "trainer", "viewer"] as SystemRole[]).map((r) => (
                      <td key={r} className="text-center px-3 py-3">
                        {row[r] ? (
                          <Check className="w-4 h-4 text-green-500 mx-auto" />
                        ) : (
                          <X className="w-4 h-4 text-gray-300 mx-auto" />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ ACTIVITY LOGS TAB ═══ */}
      {tab === "logs" && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="bg-white border border-[#E4E4DE] rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#7A7A72]" />
              <input
                className="w-full pl-9 pr-3 py-2 text-sm border border-[#E4E4DE] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#F06418]"
                placeholder="Search description..."
                value={logSearch}
                onChange={(e) => setLogSearch(e.target.value)}
              />
            </div>

            <div className="relative">
              <select
                className="w-full px-3 py-2 text-sm border border-[#E4E4DE] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#F06418] appearance-none bg-white pr-8"
                value={logUser}
                onChange={(e) => setLogUser(e.target.value)}
              >
                <option value="">All users</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.full_name}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#7A7A72] pointer-events-none" />
            </div>

            <div className="relative">
              <select
                className="w-full px-3 py-2 text-sm border border-[#E4E4DE] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#F06418] appearance-none bg-white pr-8"
                value={logAction}
                onChange={(e) => setLogAction(e.target.value)}
              >
                <option value="">All actions</option>
                {ACTION_TYPES.map((a) => (
                  <option key={a} value={a}>{a.replace(/_/g, " ")}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#7A7A72] pointer-events-none" />
            </div>

            <div className="flex gap-2">
              <input
                type="date"
                className="flex-1 px-3 py-2 text-sm border border-[#E4E4DE] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#F06418]"
                value={logFrom}
                onChange={(e) => setLogFrom(e.target.value)}
              />
              <input
                type="date"
                className="flex-1 px-3 py-2 text-sm border border-[#E4E4DE] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#F06418]"
                value={logTo}
                onChange={(e) => setLogTo(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-sm text-[#7A7A72]">
              {logTotal > 0 ? `${logTotal} log entries` : "No entries"}
            </p>
            <button
              onClick={() => loadLogs(0)}
              className="flex items-center gap-1.5 text-sm text-[#7A7A72] hover:text-[#1A1A16] transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>
          </div>

          {/* Logs table */}
          <div className="bg-white border border-[#E4E4DE] rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#F8F8F6] border-b border-[#E4E4DE]">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[#7A7A72] uppercase tracking-wide">Time</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[#7A7A72] uppercase tracking-wide hidden sm:table-cell">User</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[#7A7A72] uppercase tracking-wide">Action</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[#7A7A72] uppercase tracking-wide hidden md:table-cell">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E4E4DE]">
                {logsLoading ? (
                  [...Array(5)].map((_, i) => (
                    <tr key={i}>
                      <td colSpan={4} className="px-4 py-4">
                        <div className="h-4 bg-gray-100 animate-pulse rounded w-full" />
                      </td>
                    </tr>
                  ))
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-sm text-[#7A7A72]">
                      No activity logs found
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id} className="hover:bg-[#F8F8F6] transition-colors">
                      <td className="px-4 py-3 text-xs text-[#7A7A72] whitespace-nowrap">
                        {formatDateTime(log.created_at)}
                      </td>
                      <td className="px-4 py-3 text-xs text-[#4A4A44] hidden sm:table-cell">
                        {log.system_users
                          ? Array.isArray(log.system_users)
                            ? (log.system_users[0]?.full_name ?? "—")
                            : log.system_users.full_name
                          : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#FEF0E8] text-[#C04E10] border border-[#FDDCC8]">
                          {log.action.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-[#4A4A44] hidden md:table-cell max-w-xs truncate">
                        {log.description}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {logTotal > LOG_PAGE && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-[#7A7A72]">
                Showing {logOffset + 1}–{Math.min(logOffset + LOG_PAGE, logTotal)} of {logTotal}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={logOffset === 0}
                  onClick={() => loadLogs(logOffset - LOG_PAGE)}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={logOffset + LOG_PAGE >= logTotal}
                  onClick={() => loadLogs(logOffset + LOG_PAGE)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ ADD USER MODAL ═══ */}
      <Modal
        open={showAddModal}
        onClose={() => { setShowAddModal(false); setAddErrors({}); }}
        title="Add System User"
      >
        <div className="space-y-4">
          <Input
            label="Full Name"
            required
            value={addForm.full_name}
            onChange={(e) => setAddForm((f) => ({ ...f, full_name: e.target.value }))}
            error={addErrors.full_name}
          />
          <Input
            label="Email Address"
            type="email"
            required
            value={addForm.email}
            onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
            error={addErrors.email}
          />
          <Input
            label="Password"
            type="password"
            required
            placeholder="Min 8 characters"
            value={addForm.password}
            onChange={(e) => setAddForm((f) => ({ ...f, password: e.target.value }))}
            error={addErrors.password}
          />
          <div>
            <label className="block text-sm font-medium text-[#1A1A16] mb-1">
              Role <span className="text-red-500">*</span>
            </label>
            <select
              className="w-full px-3 py-2 text-sm border border-[#E4E4DE] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#F06418] bg-white"
              value={addForm.role}
              onChange={(e) => setAddForm((f) => ({ ...f, role: e.target.value as SystemRole }))}
            >
              <option value="owner">Owner — full access</option>
              <option value="manager">Manager — reports + packages</option>
              <option value="receptionist">Receptionist — daily ops</option>
              <option value="trainer">Trainer — attendance only</option>
              <option value="viewer">Viewer — read-only</option>
            </select>
          </div>
          {staffMembers.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-[#1A1A16] mb-1">
                Link to Staff Member <span className="text-[#7A7A72] font-normal">(optional)</span>
              </label>
              <select
                className="w-full px-3 py-2 text-sm border border-[#E4E4DE] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#F06418] bg-white"
                value={addForm.staff_id}
                onChange={(e) => setAddForm((f) => ({ ...f, staff_id: e.target.value }))}
              >
                <option value="">Not linked</option>
                {staffMembers.map((s) => (
                  <option key={s.id} value={s.id}>{s.full_name} ({s.role})</option>
                ))}
              </select>
            </div>
          )}
          <div className="flex gap-3 pt-2">
            <Button variant="secondary" className="flex-1" onClick={() => setShowAddModal(false)}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={handleAddUser} disabled={submitting}>
              {submitting ? "Creating..." : "Create User"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ═══ EDIT USER MODAL ═══ */}
      <Modal
        open={!!editUser}
        onClose={() => setEditUser(null)}
        title={`Edit User — ${editUser?.full_name ?? ""}`}
      >
        <div className="space-y-4">
          <Input
            label="Full Name"
            required
            value={editForm.full_name}
            onChange={(e) => setEditForm((f) => ({ ...f, full_name: e.target.value }))}
          />
          <div>
            <label className="block text-sm font-medium text-[#1A1A16] mb-1">Role</label>
            <select
              className="w-full px-3 py-2 text-sm border border-[#E4E4DE] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#F06418] bg-white"
              value={editForm.role}
              onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value as SystemRole }))}
            >
              <option value="owner">Owner</option>
              <option value="manager">Manager</option>
              <option value="receptionist">Receptionist</option>
              <option value="trainer">Trainer</option>
              <option value="viewer">Viewer</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-[#1A1A16] mb-1">Status</label>
            <select
              className="w-full px-3 py-2 text-sm border border-[#E4E4DE] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#F06418] bg-white"
              value={editForm.status}
              onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value as "active" | "inactive" }))}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive (cannot log in)</option>
            </select>
          </div>
          <div className="flex gap-3 pt-2">
            <Button variant="secondary" className="flex-1" onClick={() => setEditUser(null)}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={handleEditUser} disabled={submitting}>
              {submitting ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ═══ DELETE CONFIRM MODAL ═══ */}
      <Modal
        open={!!deleteUser}
        onClose={() => setDeleteUser(null)}
        title="Delete User"
      >
        <div className="space-y-4">
          <p className="text-sm text-[#4A4A44]">
            Are you sure you want to delete <strong>{deleteUser?.full_name}</strong>?
            This will disable their login and remove their access. This action cannot be undone.
          </p>
          <div className="bg-red-50 border border-red-100 rounded-lg px-4 py-3 text-sm text-red-700">
            {deleteUser?.email}
          </div>
          <div className="flex gap-3 pt-1">
            <Button variant="secondary" className="flex-1" onClick={() => setDeleteUser(null)}>
              Cancel
            </Button>
            <Button
              className="flex-1 bg-red-600 hover:bg-red-700 border-red-600 hover:border-red-700"
              onClick={handleDeleteUser}
              disabled={submitting}
            >
              {submitting ? "Deleting..." : "Delete User"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
