/**
 * Shared contract between the Blaze concierge and the ordering pages.
 *
 * Blaze keeps a server-priced cart. These helpers mirror that cart into the
 * existing `pizza_blitz_order_draft` so the customer's cart is never lost,
 * whether they start on the landing page or inside /order.
 */

export const BLAZE_OPEN_EVENT = "pizza-blitz:open-blaze";
export const BLAZE_CART_EVENT = "pizza-blitz:assistant-cart";
export const BLAZE_CHECKOUT_EVENT = "pizza-blitz:assistant-checkout";
export const ORDER_DRAFT_EVENT = "pizza-blitz:order-draft";

export const ORDER_DRAFT_STORAGE_KEY = "pizza_blitz_order_draft";
export const ORDER_DRAFT_VERSION = 1;

export type SelectedOption = {
  group_id: number;
  group_name: string;
  option_id: number;
  option_name: string;
  price_delta: number;
};

export type AssistantCartLine = {
  line_id: string;
  menu_item_id: number;
  name: string;
  category: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  selected_options: SelectedOption[];
  option_label?: string;
  image_url?: string | null;
  image_alt?: string | null;
  dietary_tags?: string[] | null;
  allergens?: string[] | null;
  calories?: number | null;
};

export type AssistantTotals = {
  lines: AssistantCartLine[];
  subtotal: number;
  discount: number;
  coupon: string | null;
  service_charge: number;
  tax: number;
  tax_rate: number;
  tax_inclusive: boolean;
  total: number;
  count: number;
};

export type AssistantRecommendation = {
  id: number;
  name: string;
  category: string;
  price: number;
  selling_price: number;
  reason: string;
  image_url?: string | null;
  image_alt?: string | null;
  dietary_tags?: string[];
  allergens?: string[];
  calories?: number | null;
};

export type AssistantAction =
  | { type: "add_item"; quantity: number; item: { menu_item_id: number; name: string; unit_price: number; selected_options: SelectedOption[] } }
  | { type: "remove_item"; menu_item_id: number }
  | { type: "clear_cart" }
  | { type: "apply_coupon"; code: string; label?: string }
  | { type: "set_fulfillment"; order_type: "pickup" | "delivery" }
  | { type: "start_checkout"; order_type: "pickup" | "delivery" }
  | { type: "open_tracking"; order_id?: number; href?: string }
  | { type: "open_url"; url: string; label?: string }
  | { type: "call_store"; phone: string };

export type AssistantStore = {
  name?: string;
  tagline?: string;
  phone?: string | null;
  email?: string | null;
  address_line?: string | null;
  map_url?: string | null;
  instagram_url?: string | null;
  prep_time_minutes?: number;
  hours_summary?: string;
  status?: {
    state?: "open" | "closed" | "paused";
    accepting_orders?: boolean;
    message?: string;
    timezone?: string;
  };
};

export type AssistantMemory = {
  known: boolean;
  display_name: string | null;
  allergies: string[];
  dietary_preferences: string[];
  favourite_items?: string[];
  usual_fulfillment?: "pickup" | "delivery" | null;
  last_order_summary?: string | null;
};

export type AssistantResponse = {
  reply: string;
  intent: string;
  source: "rules" | "gemini";
  actions: AssistantAction[];
  recommendations: AssistantRecommendation[];
  suggestions: string[];
  cart: AssistantTotals;
  fulfillment: "pickup" | "delivery";
  store: AssistantStore;
  memory?: AssistantMemory;
  memory_changed?: string[];
  memory_linked?: boolean;
  llm: { configured: boolean; used: boolean };
};

export type AssistantConfig = {
  name: string;
  greeting: string;
  llm_configured: boolean;
  store: AssistantStore;
  quick_replies: string[];
  status?: AssistantStore["status"];
};

export type AssistantCartEventDetail = {
  cart: AssistantTotals;
  fulfillment: "pickup" | "delivery";
  coupon: string | null;
  checkout?: boolean;
};

export type AssistantCartInput = {
  menu_item_id: number;
  quantity: number;
  selected_options: SelectedOption[];
};

export type AssistantLiveTotals = {
  count: number;
  total: number;
  coupon?: string | null;
  fulfillment?: "pickup" | "delivery";
};

type StoredDraft = {
  version?: number;
  cart?: { id: number; quantity: number; selected_options?: SelectedOption[] }[];
  orderType?: "pickup" | "delivery";
  address?: string;
  selectedDeliveryZoneId?: number | null;
  couponCode?: string;
  queuedCouponCode?: string;
  scheduleEnabled?: boolean;
  scheduleDate?: string;
  scheduledSlot?: string;
  scheduledLabel?: string;
  tipPercent?: string;
  customTip?: string;
  savedAt?: string;
};

export function readOrderDraft(): StoredDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ORDER_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDraft;
    if (parsed.version !== ORDER_DRAFT_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeAssistantDraft(cart: AssistantTotals, fulfillment: "pickup" | "delivery") {
  if (typeof window === "undefined") return;
  const existing = readOrderDraft();
  const draft: StoredDraft = {
    version: ORDER_DRAFT_VERSION,
    cart: cart.lines.map((line) => ({
      id: line.menu_item_id,
      quantity: line.quantity,
      selected_options: line.selected_options,
    })),
    orderType: fulfillment,
    address: existing?.address || "",
    selectedDeliveryZoneId: existing?.selectedDeliveryZoneId ?? null,
    couponCode: cart.coupon || existing?.couponCode || "",
    queuedCouponCode: existing?.queuedCouponCode || "",
    scheduleEnabled: existing?.scheduleEnabled || false,
    scheduleDate: existing?.scheduleDate,
    scheduledSlot: existing?.scheduledSlot,
    scheduledLabel: existing?.scheduledLabel,
    tipPercent: existing?.tipPercent,
    customTip: existing?.customTip,
    savedAt: new Date().toISOString(),
  };
  try {
    if (!draft.cart?.length && !draft.couponCode && !draft.address && !draft.scheduleEnabled) {
      window.localStorage.removeItem(ORDER_DRAFT_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(ORDER_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Storage can be full or blocked; the chat cart still works in memory.
  }
}

export function broadcastAssistantCart(
  cart: AssistantTotals,
  fulfillment: "pickup" | "delivery",
  options: { checkout?: boolean; coupon?: string | null } = {}
) {
  if (typeof window === "undefined") return;
  const detail: AssistantCartEventDetail = {
    cart,
    fulfillment,
    coupon: options.coupon ?? cart.coupon,
    checkout: options.checkout,
  };
  window.dispatchEvent(new CustomEvent(BLAZE_CART_EVENT, { detail }));
}

export function openBlaze(seed?: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(BLAZE_OPEN_EVENT, { detail: { seed } }));
}

function draftCount(draft: StoredDraft | null): number {
  return (draft?.cart || []).reduce(
    (total, line) => total + Math.max(0, Number(line.quantity || 0)),
    0
  );
}

/** Number of items already saved in the customer's order draft. */
export function orderDraftCount(): number {
  return draftCount(readOrderDraft());
}

/**
 * Quick-add a menu highlight to the saved order draft.
 *
 * The /order page restores the draft and applies the item's default
 * customisation, so this is safe for items with sizes and crusts. Existing
 * address, schedule, tip, and coupon choices are preserved.
 */
export function addItemToOrderDraft(item: {
  id: number;
  quantity?: number;
  selected_options?: SelectedOption[];
}): number {
  if (typeof window === "undefined") return 0;
  const existing = readOrderDraft();
  const quantity = Math.min(Math.max(Number(item.quantity || 1), 1), 20);
  const selectedOptions = item.selected_options || [];
  const optionsKey = (options: SelectedOption[]) =>
    options
      .map((option) => option.option_id)
      .sort((left, right) => left - right)
      .join("-");
  const wantedKey = optionsKey(selectedOptions);

  const cart = (existing?.cart || []).map((line) => ({
    ...line,
    selected_options: [...(line.selected_options || [])],
  }));
  const match = cart.find(
    (line) => line.id === item.id && optionsKey(line.selected_options || []) === wantedKey
  );
  if (match) {
    match.quantity = Math.min(Number(match.quantity || 0) + quantity, 20);
  } else {
    cart.push({ id: item.id, quantity, selected_options: selectedOptions });
  }

  const draft: StoredDraft = {
    version: ORDER_DRAFT_VERSION,
    cart,
    orderType: existing?.orderType || "pickup",
    address: existing?.address || "",
    selectedDeliveryZoneId: existing?.selectedDeliveryZoneId ?? null,
    couponCode: existing?.couponCode || "",
    queuedCouponCode: existing?.queuedCouponCode || "",
    scheduleEnabled: existing?.scheduleEnabled || false,
    scheduleDate: existing?.scheduleDate,
    scheduledSlot: existing?.scheduledSlot,
    scheduledLabel: existing?.scheduledLabel,
    tipPercent: existing?.tipPercent,
    customTip: existing?.customTip,
    savedAt: new Date().toISOString(),
  };

  try {
    window.localStorage.setItem(ORDER_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    return draftCount(existing);
  }

  const count = draftCount(draft);
  window.dispatchEvent(new CustomEvent(ORDER_DRAFT_EVENT, { detail: { count } }));
  return count;
}

export function requestAssistantCheckout() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(BLAZE_CHECKOUT_EVENT));
}

export function formatMoney(value: number) {
  return `₹${Math.round(Number(value || 0)).toLocaleString("en-IN")}`;
}
