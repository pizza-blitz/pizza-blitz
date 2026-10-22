/**
 * Store profile shown on the public site.
 *
 * Contact details are optional so a fresh install never publishes invented
 * addresses or phone numbers. Set the NEXT_PUBLIC_STORE_* variables (or edit
 * the defaults below) once the details are confirmed.
 */
export const storeProfile = {
  name: "Pizza Blitz",
  tagline: "Hot pizza. Fast lanes. Zero drama.",
  cuisine: "Pizza, sides, desserts and beverages",
  currency: "Rs",
  phone: process.env.NEXT_PUBLIC_STORE_PHONE || "",
  address: process.env.NEXT_PUBLIC_STORE_ADDRESS || "",
  hours: process.env.NEXT_PUBLIC_STORE_HOURS || "",
  mapsUrl: process.env.NEXT_PUBLIC_STORE_MAPS_URL || "",
  instagramUrl: process.env.NEXT_PUBLIC_STORE_INSTAGRAM || "",
  supportEmail: process.env.NEXT_PUBLIC_STORE_SUPPORT_EMAIL || "",
} as const;

export function hasStoreContact() {
  return Boolean(storeProfile.phone || storeProfile.address || storeProfile.supportEmail);
}

export function storeMapHref() {
  if (storeProfile.mapsUrl) return storeProfile.mapsUrl;
  if (!storeProfile.address) return "";
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${storeProfile.name} ${storeProfile.address}`
  )}`;
}
