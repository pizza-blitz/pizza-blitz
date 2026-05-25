function absoluteDeploymentOrigin() {
  const configuredOrigin =
    process.env.PIZZA_BLITZ_SITE_URL || process.env.NEXT_PUBLIC_SITE_URL;
  if (configuredOrigin) {
    return configuredOrigin.replace(/\/$/, "");
  }
  if (process.env.VERCEL_URL) {
    const vercelUrl = process.env.VERCEL_URL.replace(/\/$/, "");
    return vercelUrl.startsWith("http") ? vercelUrl : `https://${vercelUrl}`;
  }
  return null;
}

export function getServerApiUrl(endpoint: string) {
  const backendUrl =
    process.env.PIZZA_BLITZ_API_URL ||
    process.env.API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost:8010";
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;

  if (backendUrl.startsWith("/")) {
    const origin = absoluteDeploymentOrigin();
    if (origin) {
      return `${origin}${backendUrl}${cleanEndpoint}`;
    }
  }

  return `${backendUrl}${cleanEndpoint}`;
}
