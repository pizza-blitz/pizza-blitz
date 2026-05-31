"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  CheckCircle,
  Edit2,
  ListChecks,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

const MENU_API = getApiUrl("/api/v1/restaurant/menu/menu");
const CUSTOMIZED_MENU_API = getApiUrl("/api/v1/restaurant/menu/menu-with-customizations");
const CUSTOMIZATIONS_API = getApiUrl("/api/v1/restaurant/menu/customizations");
const CUSTOMIZATION_READINESS_API = getApiUrl("/api/v1/restaurant/menu/customizations/readiness");
const PROFITABILITY_API = getApiUrl("/api/v1/restaurant/menu/profitability");

type CustomizationOption = {
  id: number;
  name: string;
  price_delta: number;
  is_default: boolean;
};

type CustomizationGroup = {
  id: number;
  name: string;
  applies_to_categories: string[];
  selection_type: "single" | "multiple";
  min_select: number;
  max_select: number;
  options: CustomizationOption[];
};

type MenuItem = {
  id?: number;
  name: string;
  category: string;
  selling_price: number;
  cost_price: number;
  is_available: boolean;
  customization_groups?: CustomizationGroup[];
};

type ProfitabilityItem = {
  id: number;
  item: string;
  category: string;
  selling_price: number;
  cost_to_make: number;
  margin: number;
  margin_percent: number;
  cost_source: string;
  rating: string;
};

type ProfitabilityResponse = {
  items: ProfitabilityItem[];
  total_items: number;
};

type CustomizationReadiness = {
  summary: {
    active_group_count: number;
    active_option_count: number;
    customizable_item_count: number;
    fixed_item_count: number;
    covered_category_count: number;
    required_groups_without_defaults: number;
    max_upgrade_delta: number;
    average_option_delta: number;
    recent_customized_line_count: number;
  };
  groups: {
    id: number;
    name: string;
    categories: string[];
    selection_type: string;
    min_select: number;
    max_select: number;
    option_count: number;
    default_count: number;
    price_min: number;
    price_max: number;
    status: string;
  }[];
  category_coverage: {
    category: string;
    item_count: number;
    customizable_count: number;
    fixed_count: number;
    coverage_percent: number;
  }[];
  top_options: {
    option: string;
    quantity: number;
  }[];
  recent_customized_lines: {
    order_id: number;
    item: string;
    quantity: number;
    unit_price: number;
    customization_total: number;
    selected_options: {
      group_name?: string;
      option_name: string;
      price_delta: number;
    }[];
  }[];
  next_actions: string[];
};

const emptyForm: MenuItem = {
  name: "",
  category: "Pizza",
  selling_price: 0,
  cost_price: 0,
  is_available: true,
};

export default function MenuManagement() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [customizationGroups, setCustomizationGroups] = useState<CustomizationGroup[]>([]);
  const [customizationReadiness, setCustomizationReadiness] = useState<CustomizationReadiness | null>(null);
  const [profitability, setProfitability] = useState<ProfitabilityResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState<MenuItem>(emptyForm);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetchMenu(controller.signal);
    return () => controller.abort();
  }, []);

  const fetchMenu = async (signal?: AbortSignal) => {
    setIsLoading(true);
    try {
      const [menuRes, profitabilityRes, customizationsRes, readinessRes] = await Promise.all([
        fetch(CUSTOMIZED_MENU_API, { signal }),
        fetch(PROFITABILITY_API, { signal }),
        fetch(CUSTOMIZATIONS_API, { signal }),
        fetch(CUSTOMIZATION_READINESS_API, { signal }),
      ]);
      setItems(await menuRes.json());
      setProfitability(await profitabilityRes.json());
      setCustomizationGroups(await customizationsRes.json());
      setCustomizationReadiness(await readinessRes.json());
    } catch (error) {
      if (signal?.aborted) return;
      console.error("Failed to fetch menu data", error);
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  };

  const filteredItems = useMemo(
    () =>
      items.filter((item) => {
        const query = searchTerm.toLowerCase();
        return (
          item.name.toLowerCase().includes(query) ||
          item.category.toLowerCase().includes(query)
        );
      }),
    [items, searchTerm]
  );

  const openNewItem = () => {
    setFormData(emptyForm);
    setIsModalOpen(true);
  };

  const openEditItem = (item: MenuItem) => {
    setFormData(item);
    setIsModalOpen(true);
  };

  const saveItem = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const response = await fetch(MENU_API, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formData),
    });
    if (!response.ok) {
      const data = await response.json();
      setMessage(data.detail || "Menu item could not be saved.");
      return;
    }
    setMessage(`Saved ${formData.name}.`);
    setIsModalOpen(false);
    await fetchMenu();
  };

  const deleteItem = async (item: MenuItem) => {
    if (!item.id || !window.confirm(`Delete ${item.name}?`)) return;
    const response = await fetch(`${MENU_API}/${item.id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!response.ok) {
      setMessage("Menu item could not be deleted.");
      return;
    }
    setMessage(`Deleted ${item.name}.`);
    await fetchMenu();
  };

  const topProfitItems = profitability?.items.slice(0, 5) || [];

  return (
    <div className="min-h-screen bg-[#0a0a0b] p-8 text-white">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-orange-400 underline decoration-orange-500/20 underline-offset-8">
            Menu Intelligence
          </h1>
          <p className="mt-3 text-sm text-gray-500">
            Live menu pricing, availability, and margin visibility.
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => void fetchMenu()}
            className="flex items-center gap-2 rounded-xl bg-white/5 px-4 py-3 font-bold text-white hover:bg-white/10"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} /> Refresh
          </button>
          <button
            onClick={openNewItem}
            className="flex items-center gap-2 rounded-xl bg-white px-5 py-3 font-bold text-black hover:bg-orange-500 hover:text-white"
          >
            <Plus className="h-4 w-4" /> Add Item
          </button>
        </div>
      </div>

      {message && (
        <div className="mb-6 rounded-xl border border-orange-500/20 bg-orange-500/10 px-5 py-3 text-sm text-orange-100">
          {message}
        </div>
      )}

      <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-4">
        <Metric label="Menu Items" value={items.length} />
        <Metric
          label="Customizable"
          value={customizationReadiness?.summary.customizable_item_count ?? 0}
        />
        <Metric
          label="Option Sets"
          value={customizationReadiness?.summary.active_group_count ?? customizationGroups.length}
        />
        <Metric
          label="Avg Upgrade"
          value={`Rs ${Math.round(customizationReadiness?.summary.average_option_delta || 0)}`}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="xl:col-span-8">
          <div className="rounded-xl border border-white/5 bg-[#1a1a1c] p-6">
            <div className="mb-6 flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search item or category"
                  className="w-full rounded-xl border border-white/10 bg-black/30 py-3 pl-11 pr-4 outline-none focus:border-orange-500"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-left">
                <thead>
                  <tr className="border-b border-white/10 text-xs uppercase tracking-widest text-gray-500">
                    <th className="px-4 py-3">Item</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3 text-right">Selling</th>
                    <th className="px-4 py-3 text-right">Cost</th>
                    <th className="px-4 py-3">Customizations</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filteredItems.map((item) => (
                    <tr key={item.id || item.name} className="hover:bg-white/[0.03]">
                      <td className="px-4 py-4 font-black">{item.name}</td>
                      <td className="px-4 py-4">
                        <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-gray-300">
                          {item.category}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-right font-black text-orange-400">
                        Rs {Number(item.selling_price || 0).toLocaleString()}
                      </td>
                      <td className="px-4 py-4 text-right text-gray-400">
                        Rs {Number(item.cost_price || 0).toLocaleString()}
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex max-w-md flex-wrap gap-2">
                          {(item.customization_groups || []).map((group) => (
                            <span
                              key={`${item.id}-${group.id}`}
                              className="rounded-full border border-orange-400/20 bg-orange-400/10 px-3 py-1 text-xs font-black text-orange-200"
                            >
                              {group.name}
                            </span>
                          ))}
                          {!(item.customization_groups || []).length && (
                            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-bold text-gray-500">
                              Fixed item
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex justify-center">
                          {item.is_available ? (
                            <span className="flex items-center gap-1 text-xs font-bold text-green-400">
                              <CheckCircle className="h-4 w-4" /> Available
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-xs font-bold text-red-400">
                              <XCircle className="h-4 w-4" /> Out
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => openEditItem(item)}
                            className="rounded-lg bg-white/5 p-2 text-blue-300 hover:bg-blue-500/20"
                            title="Edit"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => deleteItem(item)}
                            className="rounded-lg bg-white/5 p-2 text-red-300 hover:bg-red-500/20"
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="space-y-6 xl:col-span-4">
          <div className="rounded-xl border border-white/5 bg-[#1a1a1c] p-6">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-black">
                  <ListChecks className="h-5 w-5 text-orange-400" /> Customization Command
                </h2>
                <p className="mt-1 text-xs font-semibold text-gray-500">
                  Sizes, toppings, add-ons and combo readiness for live orders.
                </p>
              </div>
              <span className="rounded-full bg-green-500/15 px-3 py-1 text-xs font-black text-green-300">
                {customizationReadiness?.summary.required_groups_without_defaults
                  ? "Review"
                  : "Ready"}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <CommandMetric
                label="Options"
                value={customizationReadiness?.summary.active_option_count ?? 0}
              />
              <CommandMetric
                label="Max Upgrade"
                value={`Rs ${Math.round(customizationReadiness?.summary.max_upgrade_delta || 0)}`}
              />
              <CommandMetric
                label="Categories"
                value={customizationReadiness?.summary.covered_category_count ?? 0}
              />
              <CommandMetric
                label="Recent Lines"
                value={customizationReadiness?.summary.recent_customized_line_count ?? 0}
              />
            </div>

            <div className="mt-4 rounded-xl border border-white/5 bg-black/25 p-4">
              <p className="text-xs font-black uppercase tracking-widest text-gray-500">
                Next Actions
              </p>
              <div className="mt-3 space-y-2">
                {(customizationReadiness?.next_actions || ["Loading customization readiness."]).map((action) => (
                  <p key={action} className="text-sm font-semibold leading-5 text-gray-300">
                    {action}
                  </p>
                ))}
              </div>
            </div>

            {!!customizationReadiness?.top_options.length && (
              <div className="mt-4">
                <p className="mb-2 text-xs font-black uppercase tracking-widest text-gray-500">
                  Top Choices
                </p>
                <div className="flex flex-wrap gap-2">
                  {customizationReadiness.top_options.slice(0, 5).map((option) => (
                    <span
                      key={option.option}
                      className="rounded-full border border-orange-400/20 bg-orange-400/10 px-3 py-1 text-xs font-black text-orange-200"
                    >
                      {option.option} x{option.quantity}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {!!customizationReadiness?.recent_customized_lines.length && (
              <div className="mt-4 space-y-2">
                <p className="text-xs font-black uppercase tracking-widest text-gray-500">
                  Kitchen-Safe Lines
                </p>
                {customizationReadiness.recent_customized_lines.slice(0, 3).map((line) => (
                  <div key={`${line.order_id}-${line.item}`} className="rounded-lg bg-black/25 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-black text-white">#{line.order_id} {line.item}</p>
                      <span className="text-xs font-black text-green-300">
                        +Rs {Math.round(line.customization_total)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs font-semibold text-gray-400">
                      {line.selected_options.map((option) =>
                        `${option.group_name || "Option"}: ${option.option_name}`
                      ).join(" | ")}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-white/5 bg-[#1a1a1c] p-6">
            <h2 className="mb-5 text-lg font-black">Customization Matrix</h2>
            <div className="space-y-3">
              {customizationGroups.map((group) => (
                <div key={group.id} className="rounded-xl border border-white/5 bg-black/25 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-black">{group.name}</p>
                      <p className="mt-1 text-xs font-bold text-gray-500">
                        {group.applies_to_categories.join(", ")} | {group.selection_type}
                      </p>
                    </div>
                    <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black text-gray-300">
                      max {group.max_select}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {group.options.map((option) => (
                      <span
                        key={option.id}
                        className={`rounded-md px-2 py-1 text-xs font-bold ${
                          option.is_default
                            ? "bg-green-500/15 text-green-300"
                            : "bg-white/5 text-gray-300"
                        }`}
                      >
                        {option.name}
                        {option.price_delta > 0 ? ` +Rs ${option.price_delta}` : ""}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
              {!customizationGroups.length && (
                <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-gray-500">
                  No customization sets configured yet.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-white/5 bg-[#1a1a1c] p-6">
            <h2 className="mb-5 flex items-center gap-2 text-lg font-black">
              <BarChart3 className="h-5 w-5 text-orange-400" /> Profitability
            </h2>
            <div className="space-y-3">
              {topProfitItems.map((item) => (
                <div key={item.id} className="rounded-xl border border-white/5 bg-black/25 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-black">{item.item}</p>
                      <p className="mt-1 text-xs text-gray-500">{item.rating}</p>
                    </div>
                    <span className="text-lg font-black text-green-400">
                      {item.margin_percent}%
                    </span>
                  </div>
                  <div className="mt-3 flex justify-between text-xs text-gray-400">
                    <span>Cost: Rs {item.cost_to_make.toLocaleString()}</span>
                    <span>Margin: Rs {item.margin.toLocaleString()}</span>
                  </div>
                </div>
              ))}
              {!topProfitItems.length && (
                <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-gray-500">
                  No profitability data yet.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <form
            onSubmit={saveItem}
            className="w-full max-w-xl rounded-xl border border-white/10 bg-[#1a1a1c] p-8"
          >
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-xl font-black">{formData.id ? "Edit Item" : "Add Item"}</h2>
              <button type="button" onClick={() => setIsModalOpen(false)} className="text-gray-500 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <Input
                label="Item Name"
                value={formData.name}
                onChange={(value) => setFormData({ ...formData, name: value })}
                required
              />
              <Input
                label="Category"
                value={formData.category}
                onChange={(value) => setFormData({ ...formData, category: value })}
                required
              />
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Input
                  label="Selling Price"
                  type="number"
                  value={String(formData.selling_price)}
                  onChange={(value) => setFormData({ ...formData, selling_price: Number(value) })}
                  required
                />
                <Input
                  label="Cost Price"
                  type="number"
                  value={String(formData.cost_price)}
                  onChange={(value) => setFormData({ ...formData, cost_price: Number(value) })}
                  required
                />
              </div>
              <label className="flex items-center gap-3 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={formData.is_available}
                  onChange={(event) =>
                    setFormData({ ...formData, is_available: event.target.checked })
                  }
                />
                Available for sale
              </label>
            </div>

            <button className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 py-4 font-black text-white hover:bg-orange-600">
              <Save className="h-4 w-4" /> Save Menu Item
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function avgMargin(items: ProfitabilityItem[]) {
  if (!items.length) return 0;
  return items.reduce((total, item) => total + item.margin_percent, 0) / items.length;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-white/5 bg-[#1a1a1c] p-5">
      <p className="text-xs font-black uppercase tracking-widest text-gray-500">{label}</p>
      <p className="mt-2 text-2xl font-black">{value}</p>
    </div>
  );
}

function CommandMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-white/5 bg-black/25 p-3">
      <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">{label}</p>
      <p className="mt-1 text-lg font-black text-white">{value}</p>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  required,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="space-y-2">
      <span className="text-xs font-black uppercase tracking-widest text-gray-500">{label}</span>
      <input
        type={type}
        value={value}
        min={type === "number" ? "0" : undefined}
        step={type === "number" ? "0.01" : undefined}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-white/10 bg-black/30 p-4 outline-none focus:border-orange-500"
        required={required}
      />
    </label>
  );
}
