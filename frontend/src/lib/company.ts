import type { ComponentType } from "react";
import {
  Activity,
  BarChart3,
  Briefcase,
  Building2,
  CalendarDays,
  CircleDollarSign,
  ClipboardList,
  Clock3,
  Crown,
  Database,
  DollarSign,
  FileText,
  Flame,
  GraduationCap,
  Headphones,
  Image as ImageIcon,
  KeyRound,
  Landmark,
  LayoutDashboard,
  ListChecks,
  Megaphone,
  MessageCircle,
  MessageSquareHeart,
  MonitorPlay,
  Package,
  PlusCircle,
  Receipt,
  ScanLine,
  Settings,
  Share2,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Store,
  Target,
  Trash2,
  Truck,
  UserPlus,
  Users,
  Utensils,
  Workflow,
  Wrench,
  Zap,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

export type PortalIcon = ComponentType<{ className?: string }>;

const ICONS: Record<string, PortalIcon> = {
  activity: Activity,
  "bar-chart": BarChart3,
  briefcase: Briefcase,
  building: Building2,
  "calendar-days": CalendarDays,
  "circle-dollar": CircleDollarSign,
  "clipboard-list": ClipboardList,
  clock: Clock3,
  crown: Crown,
  database: Database,
  "dollar-sign": DollarSign,
  "file-text": FileText,
  flame: Flame,
  "graduation-cap": GraduationCap,
  headphones: Headphones,
  image: ImageIcon,
  "key-round": KeyRound,
  landmark: Landmark,
  "layout-dashboard": LayoutDashboard,
  "list-checks": ListChecks,
  megaphone: Megaphone,
  "message-circle": MessageCircle,
  "message-heart": MessageSquareHeart,
  "monitor-play": MonitorPlay,
  package: Package,
  "plus-circle": PlusCircle,
  receipt: Receipt,
  "scan-line": ScanLine,
  settings: Settings,
  "share-2": Share2,
  "shield-check": ShieldCheck,
  "shopping-cart": ShoppingCart,
  sparkles: Sparkles,
  store: Store,
  target: Target,
  trash: Trash2,
  truck: Truck,
  "user-plus": UserPlus,
  users: Users,
  utensils: Utensils,
  workflow: Workflow,
  wrench: Wrench,
  zap: Zap,
};

export function portalIcon(name?: string | null): PortalIcon {
  if (!name) return LayoutDashboard;
  return ICONS[name] ?? LayoutDashboard;
}

export async function companyApi<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(getApiUrl(path), {
    credentials: "include",
    cache: "no-store",
    ...init,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail =
      typeof data === "object" && data && "detail" in data
        ? String((data as { detail?: unknown }).detail)
        : "Request failed.";
    throw new Error(detail || "Request failed.");
  }
  return data as T;
}

export type NavigationItem = {
  key: string;
  name: string;
  href: string;
  icon: string;
  description: string;
  permission_key?: string | null;
  department_key: string;
  department_name: string;
  is_shared: boolean;
  sort_order: number;
};

export type NavigationGroup = {
  title: string;
  sort_order: number;
  items: NavigationItem[];
};

export type NavigationDepartment = {
  key: string;
  name: string;
  color: string;
  icon: string;
  kind: string;
  parent_key?: string | null;
  role?: string | null;
  is_head: boolean;
};

export type CompanyNavigation = {
  groups: NavigationGroup[];
  departments: NavigationDepartment[];
};

export type Kpi = {
  key: string;
  label: string;
  value: number | string;
  display: string;
  detail: string;
  tone: string;
  target?: string | null;
  cadence?: string | null;
  owner?: string | null;
  href?: string | null;
};

export type WorkItem = {
  id: number;
  department_id: number;
  department_key?: string | null;
  department_name?: string | null;
  title: string;
  description?: string | null;
  kind: string;
  status: string;
  priority: string;
  owner_staff_id?: string | null;
  owner_display_name?: string | null;
  created_by?: string | null;
  due_at?: string | null;
  source_type?: string | null;
  source_id?: string | null;
  metadata?: Record<string, unknown>;
  comment_count: number;
  needs_attention: boolean;
  completed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type WorkItemComment = {
  id: number;
  work_item_id: number;
  author_staff_id?: string | null;
  author_name?: string | null;
  body: string;
  created_at?: string | null;
};

export type Approval = {
  id: number;
  department_id: number;
  department_key?: string | null;
  department_name?: string | null;
  kind: string;
  title: string;
  amount?: number | null;
  currency?: string | null;
  status: string;
  requested_by?: string | null;
  decided_by?: string | null;
  decided_at?: string | null;
  note?: string | null;
  source_type?: string | null;
  source_id?: string | null;
  metadata?: Record<string, unknown>;
  needs_attention: boolean;
  steps: {
    id: number;
    step_order: number;
    approver_staff_id?: string | null;
    status: string;
    decided_at?: string | null;
    note?: string | null;
  }[];
  created_at?: string | null;
};

export type StaffNotification = {
  id: number;
  staff_id: string;
  title: string;
  body?: string | null;
  kind?: string | null;
  link_url?: string | null;
  read_at?: string | null;
  created_at?: string | null;
};

export type WorkCounts = {
  work_items: number;
  approvals: number;
  unread_notifications: number;
  attention: number;
};

export type WorkHome = {
  departments: AccessDepartment[];
  is_admin: boolean;
  work_items: WorkItem[];
  approvals: Approval[];
  notifications: StaffNotification[];
  counts: WorkCounts;
};

export type AccessDepartment = {
  key: string;
  name: string;
  color: string;
  icon: string;
  kind: string;
  parent_key?: string | null;
  role?: string | null;
  department_role?: string | null;
  is_head: boolean;
  permissions: string[];
};

export type DepartmentAccess = {
  is_admin: boolean;
  staff_id?: string | null;
  departments: AccessDepartment[];
  permissions: Record<string, string[]>;
};

export type DepartmentAccessFlags = {
  is_admin: boolean;
  is_member: boolean;
  can_view: boolean;
  can_manage_team: boolean;
  can_manage_modules: boolean;
  can_approve: boolean;
};

export type DepartmentWorkspace = {
  id: number;
  key: string;
  name: string;
  description?: string | null;
  color: string;
  icon: string;
  status: string;
  sort_order: number;
  kind: string;
  parent_key?: string | null;
  parent_name?: string | null;
  head_staff_id?: string | null;
  head_display_name?: string | null;
  store_id?: number | null;
  cost_center?: string | null;
  external_system?: string | null;
  external_url?: string | null;
  integration_status: string;
  member_count: number;
  module_count: number;
  child_count: number;
  modules: {
    key: string;
    label: string;
    description?: string | null;
    icon?: string | null;
    route?: string | null;
    status: string;
    sort_order: number;
    permission_key?: string | null;
    nav_group?: string | null;
    is_owner: boolean;
    is_shared: boolean;
    can_view: boolean;
  }[];
  members: {
    staff_id: string;
    display_name: string;
    role: string;
    title?: string | null;
    reports_to_staff_id?: string | null;
    department_role_id?: number | null;
    department_role?: string | null;
    department_role_name?: string | null;
  }[];
  roles: {
    id: number;
    key: string;
    name: string;
    description?: string | null;
    level: string;
    is_default: boolean;
    permissions: string[];
  }[];
  children: {
    key: string;
    name: string;
    kind: string;
    status: string;
    module_count: number;
  }[];
  permissions: string[];
  permission_keys: string[];
  catalog: CatalogModule[];
  access: DepartmentAccessFlags;
  kpis: Kpi[];
  work_items: WorkItem[];
  approvals: Approval[];
  needs_you_count: number;
  quick_actions: {
    key: string;
    label: string;
    description: string;
    permission: string;
  }[];
};

export type Scorecard = {
  generated_at: string;
  departments: {
    key: string;
    name: string;
    color: string;
    kind: string;
    head_staff_id?: string | null;
    kpis: Kpi[];
    primary?: Kpi | null;
    attention_count: number;
    status: string;
  }[];
  attention_total: number;
};

export type StaffOption = {
  staff_id: string;
  display_name: string;
  is_active: boolean;
};

export type CatalogModule = {
  key: string;
  label: string;
  category: string;
  description: string;
  default_status: string;
  permission_key: string;
  owner_department: string;
  route_template?: string | null;
  icon?: string | null;
  nav_group?: string | null;
};

export const KPI_TONES: Record<string, string> = {
  good: "border-emerald-200 bg-emerald-50 text-emerald-900",
  watch: "border-amber-200 bg-amber-50 text-amber-900",
  alert: "border-red-200 bg-red-50 text-red-900",
  neutral: "border-gray-200 bg-white text-gray-900",
};

export const PRIORITY_STYLES: Record<string, string> = {
  urgent: "bg-red-100 text-red-800",
  high: "bg-orange-100 text-orange-800",
  normal: "bg-gray-100 text-gray-600",
  low: "bg-slate-100 text-slate-500",
};

export const WORK_STATUSES = ["open", "in_progress", "waiting", "done"];

export function formatWorkDate(value?: string | null) {
  if (!value) return "No due date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No due date";
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

export function titleCase(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
