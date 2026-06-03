const {
  apiJson,
  cleanupProofOrder,
  portalLoginCookie,
} = require("./helpers/order-cleanup.cjs");

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3011";
const apiURL =
  process.env.E2E_API_URL ||
  (/localhost|127\.0\.0\.1/.test(baseURL) ? "http://127.0.0.1:8010" : `${baseURL}/server`);
const adminId = process.env.E2E_ADMIN_ID || "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD || "admin123";

const proofNamePatterns = [
  /^Payment Production E2E$/i,
  /^Payment Readiness Proof$/i,
  /^Direct Bank Settlement Proof$/i,
  /^Campaign Proof Customer$/i,
  /^Reporting Dashboard Proof$/i,
  /^Segment (VIP|Regular|Cleanup|Opted Out) \d+$/i,
  /^Segment Launch VIP \d+$/i,
  /^Promotion (VIP|Regular) Audience Proof$/i,
  /^Void E2E Proof$/i,
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isActive(order) {
  return !["closed", "cancelled"].includes(String(order.status || "").toLowerCase());
}

function isProofOrder(order) {
  const name = String(order.customer_name || "").trim();
  return proofNamePatterns.some((pattern) => pattern.test(name));
}

async function main() {
  const cookie = await portalLoginCookie(baseURL, adminId, adminPassword);
  const result = await apiJson(apiURL, "/api/v1/restaurant/orders/flow-readiness", cookie);
  assert(result.response.ok, `Could not read flow readiness: ${JSON.stringify(result.data)}`);

  const orders = Array.isArray(result.data.orders) ? result.data.orders : [];
  const proofOrders = orders.filter((order) => isActive(order) && isProofOrder(order));
  const skipped = orders.filter((order) => isActive(order) && !isProofOrder(order));

  for (const order of proofOrders) {
    await cleanupProofOrder({
      apiURL,
      orderId: order.id,
      cookie,
      reason: "Cleanup of open E2E/proof order before daily close verification",
    });
  }

  const after = await apiJson(apiURL, "/api/v1/restaurant/orders/flow-readiness", cookie);
  assert(after.response.ok, `Could not read flow readiness after cleanup: ${JSON.stringify(after.data)}`);

  console.log(
    JSON.stringify(
      {
        cleaned_order_ids: proofOrders.map((order) => order.id),
        cleaned_count: proofOrders.length,
        skipped_active_orders: skipped.map((order) => ({
          id: order.id,
          customer_name: order.customer_name,
          status: order.status,
          payment_status: order.payment_status,
        })),
        active_order_count_after: after.data.summary?.active_order_count,
        open_count_after: after.data.summary?.open_count,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
