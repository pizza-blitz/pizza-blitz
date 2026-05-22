export function getServerApiUrl(endpoint: string) {
  const backendUrl =
    process.env.PIZZA_BLITZ_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost:8010";
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  return `${backendUrl}${cleanEndpoint}`;
}
