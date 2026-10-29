"use client";

import { useRouter } from "next/navigation";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowRight,
  BadgeCheck,
  ChefHat,
  Clock,
  Loader2,
  MapPin,
  Mic,
  Phone,
  Send,
  ShoppingBag,
  Sparkles,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";

import { getApiUrl } from "@/lib/api";
import ChefAvatar, { ChefPortrait, type BlazeMood } from "./chef-avatar";import {
  BLAZE_OPEN_EVENT,
  broadcastAssistantCart,
  formatMoney,
  openBlaze,
  readOrderDraft,
  requestAssistantCheckout,
  writeAssistantDraft,
  type AssistantAction,
  type AssistantCartInput,
  type AssistantConfig,
  type AssistantLiveTotals,
  type AssistantMemory,
  type AssistantRecommendation,
  type AssistantResponse,
  type AssistantTotals,
} from "./events";

const CONFIG_API = getApiUrl("/api/v1/restaurant/assistant/config");
// Same-origin route so the signed customer cookie can travel to the backend.
// The route forwards the cookie; the browser never exposes the token.
const CHAT_API = "/api/concierge";
const MEMORY_API = "/api/concierge";
const CHAT_STORAGE_KEY = "pizza_blitz_blaze_chat_v1";
const INVITE_STORAGE_KEY = "pizza_blitz_blaze_invite_v1";
const REQUEST_TIMEOUT_MS = 22000;

type ChatRole = "user" | "assistant";

type UiMessage = {
  id: string;
  role: ChatRole;
  text: string;
  recommendations?: AssistantRecommendation[];
  suggestions?: string[];
  actions?: AssistantAction[];
  intent?: string;
};

type StoredChat = {
  messages: UiMessage[];
  cart: AssistantTotals | null;
  fulfillment: "pickup" | "delivery";
  coupon: string | null;
  voiceOn: boolean;
};

type SpeechRecognitionAlternative = { transcript: string; confidence: number };
type SpeechRecognitionResult = {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternative;
};
type SpeechRecognitionResultList = {
  length: number;
  [index: number]: SpeechRecognitionResult;
};
type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: SpeechRecognitionResultList;
};
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onstart: (() => void) | null;
};

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  }
}

const fallbackSuggestions = [
  "Recommend something",
  "Show me offers",
  "Track my order",
];

function messageId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readStoredChat(): StoredChat | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredChat>;
    return {
      messages: Array.isArray(parsed.messages) ? parsed.messages.slice(-24) : [],
      cart: parsed.cart || null,
      fulfillment: parsed.fulfillment === "delivery" ? "delivery" : "pickup",
      coupon: parsed.coupon || null,
      voiceOn: Boolean(parsed.voiceOn),
    };
  } catch {
    return null;
  }
}

function persistedCartLines(cart: AssistantTotals | null) {
  if (cart?.lines?.length) {
    return cart.lines.map((line) => ({
      menu_item_id: line.menu_item_id,
      quantity: line.quantity,
      selected_options: line.selected_options,
    }));
  }
  const draft = readOrderDraft();
  const items = Array.isArray(draft?.cart) ? draft.cart : [];
  return items
    .filter((item) => Number(item.quantity) > 0)
    .map((item) => ({
      menu_item_id: Number(item.id),
      quantity: Math.min(Math.max(Number(item.quantity), 1), 20),
      selected_options: Array.isArray(item.selected_options) ? item.selected_options : [],
    }));
}

function cartCount(cart: AssistantTotals | null) {
  return cart?.count || 0;
}

function pickVoice(voices: SpeechSynthesisVoice[]) {
  const preferred = [
    /Google UK English Male/i,
    /Microsoft Guy/i,
    /Microsoft Ryan/i,
    /Daniel/i,
    /Google UK English Female/i,
    /Samantha/i,
    /Google US English/i,
  ];
  for (const matcher of preferred) {
    const match = voices.find(
      (voice) => voice.lang.startsWith("en") && matcher.test(voice.name)
    );
    if (match) return match;
  }
  return (
    voices.find((voice) => voice.lang === "en-IN") ||
    voices.find((voice) => voice.lang.startsWith("en-GB")) ||
    voices.find((voice) => voice.lang.startsWith("en")) ||
    null
  );
}

function RecommendationCard({
  item,
  disabled,
  onAdd,
}: {
  item: AssistantRecommendation;
  disabled: boolean;
  onAdd: () => void;
}) {
  return (
    <article className="flex w-[280px] shrink-0 gap-3 rounded-2xl border border-[#e6dac8] bg-white p-2.5 shadow-[0_1px_0_rgba(23,19,15,0.04)] sm:w-auto sm:min-w-0">
      <div
        role="img"
        aria-label={item.image_alt || item.name}
        className="relative h-[68px] w-[68px] shrink-0 overflow-hidden rounded-xl bg-[#f2e8d9] bg-cover bg-center"
        style={item.image_url ? { backgroundImage: `url(${item.image_url})` } : undefined}
      >
        {!item.image_url && (
          <span className="absolute inset-0 grid place-items-center text-[#a26a41]">
            <ChefHat className="h-6 w-6" aria-hidden="true" />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1 py-0.5">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate text-[13px] font-black leading-tight text-[#20160f]">
            {item.name}
          </p>
          <span className="shrink-0 text-[13px] font-black text-[#b42318]">
            {formatMoney(item.price)}
          </span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-[11px] font-medium leading-snug text-[#7a6a5b]">
          {item.reason}
        </p>
        <button
          type="button"
          onClick={onAdd}
          disabled={disabled}
          className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-[#17130f] px-2.5 py-1 text-[11px] font-black text-white transition hover:bg-[#b42318] disabled:opacity-50"
          aria-label={`Add ${item.name} to cart`}
        >
          Add <span aria-hidden="true">+</span>
        </button>
      </div>
    </article>
  );
}

function ActionChip({
  action,
  onRun,
}: {
  action: AssistantAction;
  onRun: (action: AssistantAction) => void;
}) {
  const meta = (() => {
    switch (action.type) {
      case "start_checkout":
        return { label: "Review & checkout", icon: ShoppingBag };
      case "open_tracking":
        return { label: "Track my order", icon: MapPin };
      case "open_url":
        return { label: action.label || "Open link", icon: ArrowRight };
      case "call_store":
        return { label: "Call the store", icon: Phone };
      case "apply_coupon":
        return { label: `Use ${action.code}`, icon: BadgeCheck };
      case "set_fulfillment":
        return {
          label: action.order_type === "delivery" ? "Use delivery" : "Use pickup",
          icon: Clock,
        };
      default:
        return null;
    }
  })();
  if (!meta) return null;
  const Icon = meta.icon;
  return (
    <button
      type="button"
      onClick={() => onRun(action)}
      className="inline-flex items-center gap-1.5 rounded-full border border-[#d8c7b1] bg-[#fffaf2] px-3 py-1.5 text-[11px] font-black text-[#4a392b] transition hover:border-[#b42318] hover:text-[#b42318]"
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {meta.label}
    </button>
  );
}

export function BlazeConcierge({
  open,
  onClose,
  context = "landing",
  seed = null,
  liveCart,
  liveTotals,
}: {
  open: boolean;
  onClose: () => void;
  context?: "landing" | "order";
  seed?: { value: string; token: number } | null;
  liveCart?: AssistantCartInput[];
  liveTotals?: AssistantLiveTotals;
}) {
  const router = useRouter();
  const [config, setConfig] = useState<AssistantConfig | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [cart, setCart] = useState<AssistantTotals | null>(null);
  const [fulfillment, setFulfillment] = useState<"pickup" | "delivery">("pickup");
  const [coupon, setCoupon] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
  const [voiceHint, setVoiceHint] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [hasGreeted, setHasGreeted] = useState(false);
  const [memory, setMemory] = useState<AssistantMemory | null>(null);
  const [memoryLinked, setMemoryLinked] = useState(false);
  const [forgetting, setForgetting] = useState(false);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const sendRef = useRef<(text: string) => void>(() => undefined);
  const greetedRef = useRef(false);
  const lastSeedTokenRef = useRef(0);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const sendLockRef = useRef(false);

  const mood: BlazeMood = useMemo(() => {
    if (sending) return "thinking";
    if (speaking) return "talking";
    if (listening) return "listening";
    if (messages.length && !error) return "happy";
    return "idle";
  }, [error, listening, messages.length, sending, speaking]);

  const lastAssistant = useMemo(
    () => [...messages].reverse().find((message) => message.role === "assistant"),
    [messages]
  );

  // Hydrate persisted chat and a previously started order draft.
  useEffect(() => {
    const stored = readStoredChat();
    if (stored) {
      setMessages(stored.messages);
      setCart(stored.cart);
      setFulfillment(stored.fulfillment);
      setCoupon(stored.coupon);
      setVoiceOn(stored.voiceOn);
      setHasGreeted(stored.messages.length > 0);
      greetedRef.current = stored.messages.length > 0;
    }
    const draft = readOrderDraft();
    if (!stored?.cart && draft?.orderType === "delivery") {
      setFulfillment("delivery");
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Persist chat locally, capped so storage never grows unbounded.
  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    try {
      if (!messages.length && !cart?.lines?.length) {
        window.localStorage.removeItem(CHAT_STORAGE_KEY);
        return;
      }
      const payload: StoredChat = {
        messages: messages.slice(-24),
        cart,
        fulfillment,
        coupon,
        voiceOn,
      };
      window.localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Storage is optional; the live server cart remains authoritative.
    }
  }, [cart, coupon, fulfillment, hydrated, messages, voiceOn]);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 140);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus?.();
    };
  }, [onClose, open]);

  useEffect(() => {
    if (!open) return;
    const node = transcriptRef.current;
    if (messages.length <= 1 && !sending) {
      node?.scrollTo({ top: 0, behavior: "auto" });
      return;
    }
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages, open, sending]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const speak = useCallback(
    (text: string, force = false) => {
      if ((!voiceOn && !force) || typeof window === "undefined" || !("speechSynthesis" in window)) return;
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(
          text.replace(/₹/g, " rupees ").replace(/\s+/g, " ").trim()
        );
        const voice = pickVoice(window.speechSynthesis.getVoices());
        if (voice) {
          utterance.voice = voice;
          utterance.lang = voice.lang;
        } else {
          utterance.lang = "en-IN";
        }
        utterance.rate = 1.02;
        utterance.pitch = 1;
        utterance.onstart = () => setSpeaking(true);
        utterance.onend = () => setSpeaking(false);
        utterance.onerror = () => setSpeaking(false);
        window.speechSynthesis.speak(utterance);
      } catch {
        setSpeaking(false);
      }
    },
    [voiceOn]
  );

  const applyCart = useCallback(
    (
      nextCart: AssistantTotals,
      nextFulfillment: "pickup" | "delivery",
      nextCoupon: string | null
    ) => {
      setCart(nextCart);
      setFulfillment(nextFulfillment);
      setCoupon(nextCoupon || nextCart.coupon || null);
      if (context === "order") {
        broadcastAssistantCart(nextCart, nextFulfillment, {
          coupon: nextCoupon || nextCart.coupon || null,
        });
      } else {
        writeAssistantDraft(nextCart, nextFulfillment);
      }
    },
    [context]
  );

  const sendMessage = useCallback(
    async (rawText: string) => {
      const text = rawText.trim();
      if (sendLockRef.current) return;
      if (!text && hasGreeted) return;
      sendLockRef.current = true;
      setSending(true);
      setError("");
      setVoiceHint("");
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        setSpeaking(false);
      }

      if (text) {
        setMessages((current) => [
          ...current,
          { id: messageId(), role: "user", text },
        ]);
        setInput("");
      }

      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const history = messages
          .slice(-8)
          .map((message) => ({ role: message.role, content: message.text }));
        const response = await fetch(CHAT_API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            message: text,
            cart:
              context === "order" && liveCart !== undefined
                ? liveCart
                : persistedCartLines(cart),
            fulfillment,
            coupon_code: coupon,
            history,
          }),
        });
        if (!response.ok) {
          throw new Error(`Assistant returned ${response.status}`);
        }
        const payload = (await response.json()) as AssistantResponse;
        const assistantMessage: UiMessage = {
          id: messageId(),
          role: "assistant",
          text: payload.reply,
          recommendations: payload.recommendations || [],
          suggestions: payload.suggestions || [],
          actions: payload.actions || [],
          intent: payload.intent,
        };
        setMessages((current) => [...current, assistantMessage]);
        setHasGreeted(true);
        applyCart(payload.cart, payload.fulfillment, payload.cart.coupon);
        if (payload.memory) setMemory(payload.memory);
        if (typeof payload.memory_linked === "boolean") {
          setMemoryLinked(payload.memory_linked);
        }
        speak(payload.reply);
        const checkoutAction = payload.actions.find(
          (action) => action.type === "start_checkout"
        );
        if (checkoutAction && context === "landing") {
          // Points the customer at checkout without hijacking their chat.
          writeAssistantDraft(payload.cart, payload.fulfillment);
        }
      } catch {
        setError("I lost the kitchen connection for a second. Your cart is safe — try that again.");
        setMessages((current) => [
          ...current,
          {
            id: messageId(),
            role: "assistant",
            text: "I couldn't reach the kitchen just now. Your cart is saved on this device. Try again, or open the full menu to keep ordering.",
            suggestions: ["Try again", "Show me the menu"],
          },
        ]);
      } finally {
        window.clearTimeout(timer);
        setSending(false);
        sendLockRef.current = false;
      }
    },
    [applyCart, cart, context, coupon, fulfillment, hasGreeted, liveCart, messages, speak]
  );

  sendRef.current = (text: string) => {
    void sendMessage(text);
  };

  const forgetMemory = useCallback(async () => {
    if (forgetting) return;
    setForgetting(true);
    try {
      const response = await fetch(MEMORY_API, { method: "DELETE" });
      if (response.ok) {
        setMemory(null);
        // The visible greeting recited what was remembered, and the transcript
        // is stored on this device. Forget has to remove that too, or the old
        // allergies would still be on screen after the server row is gone.
        // The cart is separate state and is deliberately kept.
        setMessages([
          {
            id: messageId(),
            role: "assistant",
            text: "Done — I've forgotten what I had saved about you. Your cart is still here. Tell me again any time you want me to remember allergies, preferences, or your usual order.",
            suggestions: ["Recommend something", "Show me offers"],
          },
        ]);
      }
    } catch {
      // Keep the strip in place; the guest can retry rather than being told
      // a row was deleted when it was not.
    } finally {
      setForgetting(false);
    }
  }, [forgetting]);

  // Load what the concierge already knows about this signed-in guest.
  useEffect(() => {
    if (!open) return;
    let active = true;
    fetch(MEMORY_API, { cache: "no-store" })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((data: { linked?: boolean; memory?: AssistantMemory } | null) => {
        if (!active || !data) return;
        setMemoryLinked(Boolean(data.linked));
        setMemory(data.memory || null);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [open]);

  // Load live config (hours, status, greeting voice) when the panel opens.
  useEffect(() => {
    if (!open) return;
    let active = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 12000);
    fetch(CONFIG_API, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as AssistantConfig;
      })
      .then((payload) => {
        if (!active || !payload) return;
        setConfig(payload);
      })
      .catch(() => undefined)
      .finally(() => window.clearTimeout(timer));
    return () => {
      active = false;
      controller.abort();
    };
  }, [open]);

  // Greet once per fresh session, or run a seed prompt from the landing page.
  useEffect(() => {
    if (!open || !hydrated) return;
    if (seed && seed.token !== lastSeedTokenRef.current) {
      lastSeedTokenRef.current = seed.token;
      greetedRef.current = true;
      setHasGreeted(true);
      void sendMessage(seed.value);
      return;
    }
    if (!greetedRef.current) {
      greetedRef.current = true;
      setHasGreeted(true);
      void sendMessage("");
    }
    // sendMessage is intentionally read at open time; re-running on every
    // render would re-greet the customer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, open, seed]);

  const startListening = useCallback(() => {
    if (typeof window === "undefined") return;
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setVoiceHint("Voice input isn't supported in this browser. Typing works just as well.");
      inputRef.current?.focus();
      return;
    }
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
    }
    try {
      const recognition = new Recognition();
      recognition.lang = "en-IN";
      recognition.continuous = false;
      recognition.interimResults = true;
      let finalTranscript = "";
      recognition.onstart = () => setListening(true);
      recognition.onresult = (event) => {
        let interim = "";
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          const transcript = result[0]?.transcript || "";
          if (result.isFinal) {
            finalTranscript += ` ${transcript}`;
          } else {
            interim += transcript;
          }
        }
        const live = `${finalTranscript} ${interim}`.trim();
        if (live) setInput(live);
      };
      recognition.onerror = (event) => {
        setListening(false);
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          setVoiceHint("Microphone access is blocked. Allow it in your browser, or type instead.");
        } else if (event.error === "no-speech") {
          setVoiceHint("I didn't catch that. Tap the mic and try once more.");
        }
      };
      recognition.onend = () => {
        setListening(false);
        const transcript = finalTranscript.trim();
        if (transcript) {
          setInput("");
          sendRef.current(transcript);
        }
        recognitionRef.current = null;
      };
      recognitionRef.current = recognition;
      recognition.start();
      setVoiceHint("");
    } catch {
      setListening(false);
      setVoiceHint("The microphone couldn't start. Check browser permissions and try again.");
    }
  }, [listening]);

  const runAction = useCallback(
    (action: AssistantAction) => {
      switch (action.type) {
        case "open_tracking":
          onClose();
          router.push(action.href || "/track");
          break;
        case "open_url":
          window.open(action.url, "_blank", "noopener,noreferrer");
          break;
        case "call_store":
          window.location.href = `tel:${action.phone}`;
          break;
        case "start_checkout":
          if (context === "order") {
            requestAssistantCheckout();
            onClose();
          } else {
            if (cart) writeAssistantDraft(cart, fulfillment);
            onClose();
            router.push("/order");
          }
          break;
        case "apply_coupon":
          void sendMessage(`Apply ${action.code}`);
          break;
        case "set_fulfillment":
          void sendMessage(action.order_type === "delivery" ? "Delivery, please" : "Pickup, please");
          break;
        default:
          break;
      }
    },
    [cart, context, fulfillment, onClose, router, sendMessage]
  );

  const reviewCart = useCallback(() => {
    if (context === "order") {
      requestAssistantCheckout();
      onClose();
      return;
    }
    if (cart) writeAssistantDraft(cart, fulfillment);
    onClose();
    router.push("/order");
  }, [cart, context, fulfillment, onClose, router]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!input.trim() || sending) return;
    void sendMessage(input);
  };

  const toggleVoice = () => {
    const next = !voiceOn;
    setVoiceOn(next);
    if (!next) {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        setSpeaking(false);
      }
      return;
    }
    // Prime the voice list inside the user gesture.
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.getVoices();
    }
    if (lastAssistant) speak(lastAssistant.text, true);
  };

  const status = config?.store?.status;
  const statusLabel =
    status?.state === "paused"
      ? "Ordering paused"
      : status?.state === "closed"
        ? "Kitchen closed"
        : "Taking orders";
  const quickReplies =
    lastAssistant?.suggestions?.length
      ? lastAssistant.suggestions
      : config?.quick_replies?.length
        ? config.quick_replies
        : fallbackSuggestions;

  const liveCount = liveCart?.length ?? 0;
  const hasServerCart = cartCount(cart) > 0;
  const footerCount = hasServerCart ? cartCount(cart) : liveTotals?.count || liveCount;
  const footerTotal = hasServerCart ? cart?.total || 0 : liveTotals?.total || 0;
  const footerFulfillment = hasServerCart
    ? fulfillment
    : liveTotals?.fulfillment || fulfillment;
  const footerCoupon = hasServerCart ? cart?.coupon || coupon : liveTotals?.coupon || coupon;
  const footerDiscount = hasServerCart ? cart?.discount || 0 : 0;

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-[#17130f]/[0.72] p-0 backdrop-blur-[3px] sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Blaze, the Pizza Blitz ordering concierge"
        className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-[#fffaf2] shadow-[0_30px_90px_rgba(0,0,0,0.45)] sm:h-[min(92vh,840px)] sm:max-w-[1120px] sm:rounded-[30px] sm:border sm:border-white/20 lg:flex-row"
      >
        {/* Avatar stage */}
        <aside className="relative hidden w-[38%] shrink-0 flex-col justify-between overflow-hidden bg-[radial-gradient(circle_at_50%_18%,#5b2d18_0%,#2c1910_46%,#17130f_100%)] p-7 text-white lg:flex">
          <div
            aria-hidden="true"
            className="absolute inset-0 opacity-[0.16]"
            style={{
              backgroundImage:
                "radial-gradient(circle at 20% 20%, #ffb36b 0, transparent 34%), radial-gradient(circle at 80% 70%, #d63a2f 0, transparent 38%)",
            }}
          />
          <div className="relative z-10 flex items-center justify-between">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/[0.15] bg-white/10 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.16em] text-amber-200">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              Live menu brain
            </span>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${
                status?.state === "open"
                  ? "bg-emerald-400/15 text-emerald-200"
                  : "bg-amber-400/15 text-amber-200"
              }`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {statusLabel}
            </span>
          </div>

          <div className="relative z-10 my-4 h-[380px] w-full">
            <div className="absolute left-1/2 top-1/2 h-[330px] w-[330px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/10" />
            <div className="absolute left-1/2 top-1/2 h-[250px] w-[250px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-400/10 blur-2xl" />
            {isDesktop && (
              <ChefAvatar mood={mood} label="Blaze, your 3D pizza concierge" />
            )}
            <div className="pointer-events-none absolute left-0 top-8 rounded-2xl border border-white/[0.12] bg-white/10 px-3 py-2 text-[11px] font-bold text-white/90 backdrop-blur">
              <Clock className="mb-1 h-3.5 w-3.5 text-amber-300" aria-hidden="true" />
              Live pickup times
            </div>
            <div className="pointer-events-none absolute bottom-16 right-0 rounded-2xl border border-white/[0.12] bg-white/10 px-3 py-2 text-[11px] font-bold text-white/90 backdrop-blur">
              <BadgeCheck className="mb-1 h-3.5 w-3.5 text-emerald-300" aria-hidden="true" />
              Server-priced cart
            </div>
            <div className="pointer-events-none absolute bottom-1 left-2 rounded-2xl border border-white/[0.12] bg-white/10 px-3 py-2 text-[11px] font-bold text-white/90 backdrop-blur">
              <Mic className="mb-1 h-3.5 w-3.5 text-rose-300" aria-hidden="true" />
              Talk or type
            </div>
          </div>

          <div className="relative z-10">
            <p className="text-2xl font-black leading-tight tracking-tight">
              He takes the order.
              <br />
              <span className="text-amber-300">The kitchen gets it right.</span>
            </p>
            <p className="mt-2 max-w-[270px] text-xs font-medium leading-5 text-white/60">
              Blaze reads the live menu, applies real offers, and hands the
              finished cart to checkout. No invented prices, ever.
            </p>
            <button
              type="button"
              onClick={toggleVoice}
              className="mt-5 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3.5 py-2 text-[11px] font-black uppercase tracking-wide text-white transition hover:bg-white/20"
              aria-pressed={voiceOn}
            >
              {voiceOn ? (
                <Volume2 className="h-4 w-4" aria-hidden="true" />
              ) : (
                <VolumeX className="h-4 w-4" aria-hidden="true" />
              )}
              {voiceOn ? "Voice replies on" : "Voice replies off"}
            </button>
            {config?.store?.hours_summary && (
              <p className="mt-4 flex items-center gap-1.5 text-[11px] font-semibold text-white/[0.55]">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                {config.store.hours_summary}
              </p>
            )}
          </div>
        </aside>

        {/* Chat */}
        <section className="flex min-h-0 flex-1 flex-col bg-[#fffaf2]">
          <header className="flex items-center justify-between gap-3 border-b border-[#eadfce] px-4 py-3 sm:px-5">
            <div className="flex min-w-0 items-center gap-3">
              <span className="relative grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-[#ffe7c6] to-[#f3b17a] ring-2 ring-[#b42318]/[0.15]">
                <ChefPortrait className="h-9 w-9" />
                <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-[#20160f]">Blaze</p>
                <p className="text-[11px] font-semibold text-[#7a6a5b]">
                  {sending
                    ? "Checking the kitchen…"
                    : listening
                      ? "Listening…"
                      : "Live menu · voice ordering"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={toggleVoice}
                className="grid h-9 w-9 place-items-center rounded-full border border-[#e2d3c0] text-[#5b4636] transition hover:border-[#b42318] hover:text-[#b42318] lg:hidden"
                aria-label={voiceOn ? "Turn voice replies off" : "Turn voice replies on"}
                aria-pressed={voiceOn}
              >
                {voiceOn ? (
                  <Volume2 className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <VolumeX className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="grid h-9 w-9 place-items-center rounded-full border border-[#e2d3c0] text-[#5b4636] transition hover:border-[#b42318] hover:text-[#b42318]"
                aria-label="Close Blaze"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </header>

          {memoryLinked &&
          memory &&
          (memory.allergies.length > 0 ||
            memory.dietary_preferences.length > 0 ||
            Boolean(memory.last_order_summary)) ? (
            <div className="flex items-start gap-2 border-b border-[#eadfce] bg-[#fff4e6] px-4 py-2 sm:px-5">
              <BadgeCheck
                className="mt-0.5 h-4 w-4 shrink-0 text-[#1f7a4d]"
                aria-hidden="true"
              />
              <p className="min-w-0 flex-1 text-[11px] font-semibold leading-4 text-[#5b4636]">
                <span className="font-black text-[#20160f]">
                  Remembered from last visit:
                </span>{" "}
                {[
                  ...memory.allergies.map((allergy) => `avoid ${allergy}`),
                  ...memory.dietary_preferences,
                  ...(memory.last_order_summary
                    ? [`last order ${memory.last_order_summary}`]
                    : []),
                ].join(" · ")}
              </p>
              <button
                type="button"
                onClick={() => void forgetMemory()}
                disabled={forgetting}
                className="shrink-0 text-[11px] font-black text-[#b42318] underline underline-offset-2 disabled:opacity-50"
              >
                {forgetting ? "Forgetting…" : "Forget"}
              </button>
            </div>
          ) : !memoryLinked && messages.length > 0 ? (
            <div className="flex items-center gap-2 border-b border-[#eadfce] bg-[#fff4e6] px-4 py-2 sm:px-5">
              <Sparkles
                className="h-3.5 w-3.5 shrink-0 text-[#b42318]"
                aria-hidden="true"
              />
              <p className="min-w-0 flex-1 text-[11px] font-semibold leading-4 text-[#5b4636]">
                Sign in and I will remember allergies and your usual order next
                time.
              </p>
              <button
                type="button"
                onClick={() => router.push("/account/login?next=/")}
                className="shrink-0 text-[11px] font-black text-[#b42318] underline underline-offset-2"
              >
                Sign in
              </button>
            </div>
          ) : null}

          {!isDesktop && (
            <div className="relative h-[150px] shrink-0 overflow-hidden bg-[radial-gradient(circle_at_50%_20%,#5b2d18_0%,#2c1910_52%,#17130f_100%)]">
              <div className="absolute inset-0 opacity-20" aria-hidden="true"
                style={{
                  backgroundImage:
                    "radial-gradient(circle at 70% 30%, #ffb36b 0, transparent 40%)",
                }}
              />
              <ChefAvatar mood={mood} compact label="Blaze, your 3D pizza concierge" />
              <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-amber-200 backdrop-blur">
                <Sparkles className="h-3 w-3" aria-hidden="true" />
                Live menu
              </span>
              <span className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-black text-white/80 backdrop-blur">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                {statusLabel}
              </span>
            </div>
          )}

          <div
            ref={transcriptRef}
            className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5"
            aria-live="polite"
            aria-relevant="additions"
          >
            {!messages.length && (
              <div className="mx-auto max-w-sm pt-8 text-center">
                <ChefPortrait className="mx-auto h-20 w-20" />
                <p className="mt-3 text-lg font-black tracking-tight text-[#20160f]">
                  {config?.greeting
                    ? "Hey, I'm Blaze."
                    : "Warming up the oven…"}
                </p>
                <p className="mt-1.5 text-sm leading-6 text-[#6b5a4b]">
                  Tell me what you&apos;re craving. I&apos;ll build the cart, find
                  live offers, and get you to checkout.
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {fallbackSuggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => void sendMessage(suggestion)}
                      className="rounded-full border border-[#d8c7b1] bg-white px-3 py-1.5 text-xs font-bold text-[#4a392b] transition hover:border-[#b42318] hover:text-[#b42318]"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((message) =>
              message.role === "user" ? (
                <div key={message.id} className="flex justify-end">
                  <p className="max-w-[85%] rounded-2xl rounded-br-md bg-[#20160f] px-4 py-2.5 text-sm font-medium leading-6 text-white">
                    {message.text}
                  </p>
                </div>
              ) : (
                <div key={message.id} className="flex gap-2.5">
                  <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-full bg-[#f4e3cd] ring-1 ring-[#e2d3c0]">
                    <ChefPortrait className="h-7 w-7" />
                  </span>
                  <div className="min-w-0 max-w-[86%] space-y-2">
                    <div className="rounded-2xl rounded-tl-md border border-[#eadfce] bg-white px-3.5 py-2.5 shadow-[0_1px_0_rgba(23,19,15,0.03)]">
                      <p className="whitespace-pre-line text-sm font-medium leading-6 text-[#33261b]">
                        {message.text}
                      </p>
                    </div>
                    {!!message.recommendations?.length && (
                      <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] sm:grid sm:grid-cols-2 sm:overflow-visible">
                        {message.recommendations.map((item) => (
                          <RecommendationCard
                            key={`${message.id}-${item.id}`}
                            item={item}
                            disabled={sending}
                            onAdd={() => void sendMessage(`Add ${item.name}`)}
                          />
                        ))}
                      </div>
                    )}
                    {!!message.actions?.length && (
                      <div className="flex flex-wrap gap-1.5">
                        {message.actions.map((action, index) => (
                          <ActionChip
                            key={`${message.id}-${action.type}-${index}`}
                            action={action}
                            onRun={runAction}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            )}

            {sending && (
              <div className="flex items-center gap-2 text-[#7a6a5b]">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-[#f4e3cd]">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                </span>
                <span className="inline-flex gap-1 rounded-2xl rounded-tl-md border border-[#eadfce] bg-white px-3 py-2">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#b42318] [animation-delay:-0.2s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#b42318] [animation-delay:-0.1s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#b42318]" />
                </span>
              </div>
            )}
            <div ref={endRef} />
          </div>

          {!!quickReplies.length && (
            <div className="flex gap-2 overflow-x-auto border-t border-[#eadfce]/70 px-4 py-2.5 [scrollbar-width:none] sm:px-5">
              {quickReplies.slice(0, 4).map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={sending}
                  onClick={() => void sendMessage(suggestion)}
                  className="shrink-0 rounded-full border border-[#d8c7b1] bg-[#fffaf2] px-3 py-1.5 text-[11px] font-bold text-[#4a392b] transition hover:border-[#b42318] hover:text-[#b42318] disabled:opacity-50"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}

          {footerCount > 0 && (
            <div className="border-t border-[#eadfce] bg-[#fff6e8] px-4 py-2.5 sm:px-5">
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={reviewCart}
                  className="flex min-w-0 items-center gap-2.5 text-left"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#20160f] text-white">
                    <ShoppingBag className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-black text-[#20160f]">
                      {footerCount} item{footerCount === 1 ? "" : "s"}
                      {footerTotal > 0 ? ` · ${formatMoney(footerTotal)}` : ""}
                    </span>
                    <span className="block truncate text-[10px] font-semibold text-[#7a6a5b]">
                      {footerFulfillment === "delivery" ? "Delivery" : "Pickup"}
                      {footerDiscount ? ` · saving ${formatMoney(footerDiscount)}` : ""}
                      {footerCoupon ? ` · ${footerCoupon}` : ""}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={reviewCart}
                  className="shrink-0 rounded-xl bg-[#b42318] px-3.5 py-2.5 text-[11px] font-black uppercase tracking-wide text-white transition hover:bg-[#941d14]"
                >
                  {context === "order" ? "Checkout" : "Review cart"}
                </button>
              </div>
            </div>
          )}

          <div className="border-t border-[#eadfce] bg-white px-3 py-3 sm:px-4">
            {voiceHint && (
              <p className="mb-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-900">
                {voiceHint}
              </p>
            )}
            {error && (
              <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-red-50 px-2.5 py-1.5">
                <p className="text-[11px] font-semibold text-red-800">{error}</p>
                <button
                  type="button"
                  onClick={() => void sendMessage("Recommend something")}
                  className="shrink-0 text-[11px] font-black text-red-800 underline"
                >
                  Retry
                </button>
              </div>
            )}
            <form onSubmit={submit} className="flex items-center gap-2">
              <button
                type="button"
                onClick={startListening}
                className={`grid h-11 w-11 shrink-0 place-items-center rounded-full border transition ${
                  listening
                    ? "animate-pulse border-[#b42318] bg-[#b42318] text-white"
                    : "border-[#e2d3c0] bg-[#fffaf2] text-[#5b4636] hover:border-[#b42318] hover:text-[#b42318]"
                }`}
                aria-label={listening ? "Stop listening" : "Speak your order"}
                aria-pressed={listening}
              >
                <Mic className="h-[18px] w-[18px]" aria-hidden="true" />
              </button>
              <label htmlFor="blaze-message" className="sr-only">
                Message Blaze
              </label>
              <input
                id="blaze-message"
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  // Enter should always send. The form's submit handler covers
                  // most browsers, but focusing edge cases (and some in-app
                  // browsers) swallowed it; this makes the behaviour explicit.
                  if (event.key !== "Enter" || event.shiftKey) return;
                  if ((event.nativeEvent as KeyboardEvent).isComposing) return;
                  event.preventDefault();
                  if (!input.trim() || sending) return;
                  void sendMessage(input);
                }}
                maxLength={500}
                placeholder={
                  listening
                    ? "Listening — say your order…"
                    : 'Try "two margherita pizzas and garlic bread"'
                }
                className="h-11 min-w-0 flex-1 rounded-full border border-[#e2d3c0] bg-[#fffaf2] px-4 text-sm font-medium text-[#20160f] outline-none placeholder:text-[#a49384] focus:border-[#b42318] focus:ring-2 focus:ring-[#b42318]/[0.15]"
                autoComplete="off"
              />
              <button
                type="submit"
                disabled={!input.trim() || sending}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#b42318] text-white transition hover:bg-[#941d14] disabled:opacity-40"
                aria-label="Send message"
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Send className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </form>
            <p className="mt-2 flex items-center justify-center gap-1 text-center text-[10px] font-semibold text-[#9a8a7a]">
              <BadgeCheck className="h-3 w-3" aria-hidden="true" />
              Prices and offers come from the live kitchen system
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

export function BlazeDock({
  context = "landing",
  className = "",
  liveCart,
  liveTotals,
}: {
  context?: "landing" | "order";
  className?: string;
  liveCart?: AssistantCartInput[];
  liveTotals?: AssistantLiveTotals;
}) {
  const [open, setOpen] = useState(false);
  const [seed, setSeed] = useState<{ value: string; token: number } | null>(null);
  const [invite, setInvite] = useState<{ line: string; note: string | null } | null>(
    null
  );

  const rememberInvite = useCallback(() => {
    setInvite(null);
    try {
      window.sessionStorage.setItem(INVITE_STORAGE_KEY, "1");
    } catch {
      // Private modes can refuse storage; the greeting still disappears now.
    }
  }, []);

  useEffect(() => {
    const onOpenRequest = (event: Event) => {
      const detail = (event as CustomEvent<{ seed?: string }>).detail;
      if (detail?.seed) setSeed({ value: detail.seed, token: Date.now() });
      setInvite(null);
      setOpen(true);
    };
    window.addEventListener(BLAZE_OPEN_EVENT, onOpenRequest);
    return () => window.removeEventListener(BLAZE_OPEN_EVENT, onOpenRequest);
  }, []);

  // A landing visitor meets Blaze without having to find the dock first. The
  // greeting stays out of the way, appears once per browser session, and is
  // personalised only from the signed-in customer's own memory.
  useEffect(() => {
    if (context !== "landing") return;
    try {
      if (window.sessionStorage.getItem(INVITE_STORAGE_KEY)) return;
    } catch {
      // No storage means no memory of a dismissal; still greet once here.
    }
    let active = true;
    const timer = window.setTimeout(() => {
      if (!active) return;
      setInvite({
        line: "Hi, I'm Blaze. Tell me what you're craving and I'll build the whole order.",
        note: null,
      });
      fetch(MEMORY_API, { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : null))
        .then((payload: { linked?: boolean; memory?: AssistantMemory } | null) => {
          if (!active || !payload?.linked || !payload.memory?.known) return;
          const memory = payload.memory;
          const rawName = memory.display_name?.trim() || "";
          // New accounts carry the placeholder "Pizza Guest"; it is not a name.
          const name = /^(pizza guest|pizza blitz guest|guest)$/i.test(rawName)
            ? ""
            : rawName.split(/\s+/)[0];
          const favourite = memory.favourite_items?.[0];
          const again = favourite ? `Want ${favourite} again?` : "Want the usual?";
          setInvite({
            line: name ? `Welcome back, ${name}. ${again}` : `Welcome back. ${again}`,
            note: memory.allergies?.length
              ? `I remember: no ${memory.allergies.slice(0, 2).join(", no ")}.`
              : null,
          });
        })
        .catch(() => undefined);
    }, 4200);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [context]);

  return (
    <>
      {invite && !open && (
        <div
          role="status"
          aria-live="polite"
          data-testid="blaze-invite"
          className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)+9.5rem)] right-4 z-[70] w-[min(20rem,calc(100vw-2rem))] sm:bottom-[5.75rem] sm:right-6"
        >
          <div className="relative flex items-start gap-2.5 rounded-2xl border border-[#e6dac8] bg-white p-3 pr-7 text-[#17130f] shadow-[0_18px_50px_rgba(23,19,15,0.3)]">
            <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-[#ffe8c9] to-[#eea86c]">
              <ChefPortrait className="h-8 w-8" />
            </span>
            <button
              type="button"
              onClick={() => {
                rememberInvite();
                setOpen(true);
              }}
              className="min-w-0 text-left"
              aria-label="Chat with Blaze about your order"
            >
              <span className="block text-[10px] font-black uppercase tracking-[0.14em] text-[#b42318]">
                Blaze
              </span>
              <span className="mt-0.5 block text-xs font-bold leading-snug">
                {invite.line}
              </span>
              {invite.note && (
                <span className="mt-1 block text-[11px] font-semibold leading-snug text-amber-800">
                  {invite.note}
                </span>
              )}
            </button>
            <button
              type="button"
              data-testid="blaze-invite-dismiss"
              onClick={rememberInvite}
              aria-label="Dismiss Blaze greeting"
              className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full text-[#17130f]/50 transition hover:bg-[#17130f]/5 hover:text-[#17130f]"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <span
              aria-hidden="true"
              className="absolute -bottom-1.5 right-7 h-3 w-3 rotate-45 border-b border-r border-[#e6dac8] bg-white"
            />
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => {
          rememberInvite();
          setOpen(true);
        }}
        className={`group fixed z-[70] flex items-center gap-2.5 rounded-full border border-white/[0.15] bg-[#17130f] py-1.5 pl-1.5 pr-4 text-left shadow-[0_14px_40px_rgba(23,19,15,0.38)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_48px_rgba(23,19,15,0.45)] bottom-[calc(env(safe-area-inset-bottom,0px)+5.25rem)] ${
          context === "order"
            ? "left-4 right-auto sm:bottom-6 sm:left-6"
            : "right-4 sm:bottom-6 sm:right-6"
        } ${className}`}
        aria-label="Open Blaze, the AI ordering concierge"
      >
        <span className="relative grid h-11 w-11 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-[#ffe8c9] to-[#eea86c]">
          <ChefPortrait className="h-10 w-10" />
          <span className="absolute bottom-0.5 right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#17130f] bg-emerald-400" />
          <span className="absolute inset-0 rounded-full ring-2 ring-amber-300/40 transition group-hover:ring-amber-300/70" />
        </span>
        <span className="hidden sm:block">
          <span className="block text-[13px] font-black leading-tight text-white">
            Ask Blaze
          </span>
          <span className="block text-[10px] font-semibold text-white/[0.55]">
            Talk · order · offers
          </span>
        </span>
        <span className="block text-[13px] font-black text-white sm:hidden">Ask</span>
        <ArrowRight className="hidden h-4 w-4 text-amber-300 transition group-hover:translate-x-0.5 sm:block" aria-hidden="true" />
      </button>

      <BlazeConcierge
        open={open}
        onClose={() => setOpen(false)}
        context={context}
        seed={seed}
        liveCart={liveCart}
        liveTotals={liveTotals}
      />
    </>
  );
}

/** Conversion card used in the landing hero. Opens the same live concierge. */
export function BlazeHeroCard() {
  const [config, setConfig] = useState<AssistantConfig | null>(null);

  useEffect(() => {
    let active = true;
    fetch(CONFIG_API, { cache: "no-store" })
      .then(async (response) => (response.ok ? ((await response.json()) as AssistantConfig) : null))
      .then((payload) => {
        if (active && payload) setConfig(payload);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const status = config?.store?.status;
  const openLabel =
    status?.state === "paused"
      ? "Ordering paused"
      : status?.state === "closed"
        ? "Kitchen closed"
        : "Open · taking orders";
  const prompt =
    config?.store?.tagline || "Fresh dough, fired to order. Tell me what you're craving.";

  return (
    <div className="relative overflow-hidden rounded-[28px] border border-white/[0.15] bg-[radial-gradient(circle_at_50%_10%,#5f3019_0%,#2c1910_48%,#17130f_100%)] p-5 text-white shadow-[0_24px_70px_rgba(0,0,0,0.35)] sm:p-6">
      <div
        aria-hidden="true"
        className="absolute -right-10 -top-12 h-48 w-48 rounded-full bg-[#f97316]/20 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="absolute -bottom-16 -left-10 h-48 w-48 rounded-full bg-[#b42318]/25 blur-3xl"
      />
      <div className="relative flex items-start justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200/25 bg-amber-200/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-amber-200">
          <Sparkles className="h-3 w-3" aria-hidden="true" />
          Meet Blaze · 3D concierge
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-bold text-white/80">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          {openLabel}
        </span>
      </div>

      <div className="relative mt-3 flex items-center gap-4">
        <div className="relative h-[104px] w-[92px] shrink-0">
          <ChefPortrait className="h-full w-full" />
          <span className="absolute -right-1 top-2 rounded-full border border-white/[0.15] bg-[#17130f]/80 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-amber-200 backdrop-blur">
            3D
          </span>
        </div>
        <div className="min-w-0">
          <p className="text-[15px] font-black leading-snug">
            &ldquo;Tell me what you&apos;re craving — I&apos;ll build the whole order.&rdquo;
          </p>
          <p className="mt-1 line-clamp-2 text-[11px] font-medium leading-5 text-white/60">
            {prompt}
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => openBlaze()}
        className="relative mt-4 flex w-full items-center gap-3 rounded-2xl border border-white/[0.15] bg-white/[0.07] p-2 text-left backdrop-blur transition hover:border-amber-200/40 hover:bg-white/[0.11]"
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#b42318] text-white">
          <Mic className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-bold text-white/90">
            Ask Blaze or speak your order
          </span>
          <span className="block truncate text-[10px] font-semibold text-white/[0.45]">
            &ldquo;Two margherita pizzas and garlic bread&rdquo;
          </span>
        </span>
        <ArrowRight className="h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
      </button>

      <div className="relative mt-3 flex flex-wrap gap-1.5">
        {["Recommend something", "Show me offers", "What's vegetarian?"].map((seed) => (
          <button
            key={seed}
            type="button"
            onClick={() => openBlaze(seed)}
            className="rounded-full border border-white/[0.12] bg-white/[0.06] px-2.5 py-1 text-[10px] font-bold text-white/70 transition hover:border-amber-200/40 hover:text-white"
          >
            {seed}
          </button>
        ))}
      </div>
    </div>
  );
}
