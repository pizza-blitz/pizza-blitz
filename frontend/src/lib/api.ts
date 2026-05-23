// src/lib/api.ts
function getBackendUrl() {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL;
  }
  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:8010`;
  }
  return "http://localhost:8010";
}

export const getApiUrl = (endpoint: string) => {
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${getBackendUrl()}${cleanEndpoint}`;
};

export const API_ENDPOINTS = {
  DASHBOARD_STATS: '/api/v1/restaurant/stats/dashboard-stats',
  SALES: '/api/v1/restaurant/sales/',
  SALES_HISTORY: '/api/v1/restaurant/sales/history',
  DAILY_ENTRY: '/api/v1/restaurant/sales/daily-entry',
  INVENTORY_ITEMS: '/api/v1/restaurant/inventory/items',
  EXPENSES: '/api/v1/restaurant/expenses/expenses',
  OCR_SCAN: '/api/v1/restaurant/ocr/scan-bill',
  REPORTS_FORECAST: '/api/v1/restaurant/stats/insights/monthly-forecast',
  REPORTS_PROFIT: '/api/v1/restaurant/stats/insights/profit-trend',
};
