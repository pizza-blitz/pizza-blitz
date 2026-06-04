const fs = require("fs");
const path = require("path");

const e2eDir = __dirname;
const frontendDir = path.resolve(e2eDir, "..");
const appDir = path.join(frontendDir, "src", "app");
const artifactsDir = path.join(e2eDir, "artifacts");
const artifactPath = path.join(artifactsDir, "route-action-inventory.json");

const publicRoutes = ["/", "/order", "/track", "/login", "/account/login", "/account"];
const adminRoutes = [
  "/dashboard",
  "/roadmap",
  "/ceo",
  "/orders",
  "/counter",
  "/operations",
  "/shifts",
  "/daily",
  "/sales",
  "/reports",
  "/invoices",
  "/breakeven",
  "/menu",
  "/inventory",
  "/inventory/scan",
  "/recipes",
  "/customers",
  "/promotions",
  "/communications",
  "/social",
  "/ads",
  "/ops",
  "/vendors",
  "/waste",
  "/expenses",
  "/ai-insights",
  "/purchase-orders",
  "/settings",
];

const allowedActionClasses = new Set([
  "admin-config",
  "analytics",
  "approval",
  "auth",
  "cart",
  "checkout",
  "content",
  "delivery",
  "export",
  "form-input",
  "inventory",
  "kitchen",
  "marketing",
  "mutation",
  "navigation",
  "payment-gated",
  "pos",
  "production",
  "protected",
  "provider-gated",
  "reporting",
  "safe-filter",
  "tracking",
]);

function routeSource(route, options = {}) {
  if (options.sourcePath) return options.sourcePath;
  if (route === "/") return "page.tsx";

  const segments = route.split("/").filter(Boolean);
  const prefix = options.admin ? ["(dashboard)"] : [];
  return path.join(...prefix, ...segments, "page.tsx");
}

function entry(route, area, proof, actionClasses, options = {}) {
  return {
    route,
    area,
    surface: options.surface || (options.admin ? "admin" : "public"),
    ownerRole: options.ownerRole || (options.admin ? "admin" : "customer"),
    sourceRoute: options.sourceRoute !== false,
    sourcePath: routeSource(route, options),
    proof,
    actionClasses,
    gate: options.gate || "",
  };
}

const routeInventory = [
  entry("/", "Public website entry", "verify-visual-polish-suite.cjs", ["navigation", "content"]),
  entry("/order", "Customer ordering funnel", "verify-full-customer-order-e2e.cjs", [
    "navigation",
    "cart",
    "checkout",
    "payment-gated",
    "mutation",
  ]),
  entry("/track", "Customer tracking and reorder", "verify-track-reorder-loop.cjs", [
    "form-input",
    "tracking",
    "cart",
  ]),
  entry("/login", "Admin and staff login", "verify-login-loop-and-simple-pos.cjs", ["auth", "protected"]),
  entry("/account/login", "Customer login", "verify-customer-account-lifecycle.cjs", ["auth"]),
  entry("/account", "Customer account lifecycle", "verify-customer-account-lifecycle.cjs", [
    "form-input",
    "mutation",
    "tracking",
  ]),
  entry("/dashboard", "Owner operating dashboard", "verify-operational-dashboard-command.cjs", [
    "analytics",
    "navigation",
    "protected",
  ], { admin: true }),
  entry("/roadmap", "Roadmap and proof tracker", "verify-roadmap-command-board.cjs", [
    "analytics",
    "reporting",
    "protected",
  ], { admin: true }),
  entry("/ceo", "Owner command view", "verify-action-feedback-hygiene.cjs", [
    "analytics",
    "reporting",
    "protected",
  ], { admin: true }),
  entry("/orders", "Order management", "verify-order-flow-polish.cjs", [
    "safe-filter",
    "mutation",
    "delivery",
    "protected",
  ], { admin: true }),
  entry("/counter", "Counter POS", "verify-counter-order-e2e.cjs", [
    "pos",
    "cart",
    "checkout",
    "payment-gated",
    "mutation",
    "protected",
  ], { admin: true }),
  entry("/operations", "Kitchen and delivery operations", "verify-delivery-assignment-readiness.cjs", [
    "kitchen",
    "delivery",
    "mutation",
    "protected",
  ], { admin: true }),
  entry("/shifts", "Employee attendance", "verify-employee-attendance-command.cjs", [
    "form-input",
    "mutation",
    "protected",
  ], { admin: true }),
  entry("/daily", "Daily close and cash drawer", "verify-daily-close-command.cjs", [
    "approval",
    "export",
    "mutation",
    "protected",
  ], { admin: true }),
  entry("/sales", "Sales analytics", "verify-reporting-comparison-dashboard.cjs", [
    "analytics",
    "reporting",
    "safe-filter",
    "protected",
  ], { admin: true }),
  entry("/reports", "Comparison reports", "verify-reporting-comparison-dashboard.cjs", [
    "analytics",
    "reporting",
    "safe-filter",
    "export",
    "protected",
  ], { admin: true }),
  entry("/invoices", "Invoice reporting", "verify-reporting-action-board.cjs", [
    "reporting",
    "export",
    "protected",
  ], { admin: true }),
  entry("/breakeven", "Breakeven analytics", "verify-breakeven-setup-feedback.cjs", [
    "analytics",
    "reporting",
    "mutation",
    "protected",
  ], { admin: true }),
  entry("/menu", "Menu and pricing controls", "verify-product-customization.cjs", [
    "content",
    "mutation",
    "protected",
  ], { admin: true }),
  entry("/inventory", "Inventory command board", "verify-inventory-command-board.cjs", [
    "inventory",
    "form-input",
    "mutation",
    "protected",
  ], { admin: true }),
  entry("/inventory/scan", "Inventory bill scanner", "verify-visual-polish-suite.cjs", [
    "inventory",
    "form-input",
    "mutation",
    "protected",
  ], { admin: true }),
  entry("/recipes", "Recipe costing and prep data", "verify-product-customization.cjs", [
    "content",
    "inventory",
    "protected",
  ], { admin: true }),
  entry("/customers", "Customer CRM and segments", "verify-customer-segment-reporting.cjs", [
    "analytics",
    "marketing",
    "safe-filter",
    "protected",
  ], { admin: true }),
  entry("/promotions", "Campaign and offer launch", "verify-promotion-launch-bundle.cjs", [
    "marketing",
    "provider-gated",
    "mutation",
    "protected",
  ], { admin: true, gate: "Live WhatsApp/SMS/email send needs owner-approved provider credentials." }),
  entry("/communications", "Communication center", "verify-communication-center.cjs", [
    "marketing",
    "provider-gated",
    "protected",
  ], { admin: true, gate: "Live sending remains credential-gated." }),
  entry("/social", "Social publishing", "verify-social-autopost-mission-control.cjs", [
    "marketing",
    "provider-gated",
    "mutation",
    "protected",
  ], { admin: true, gate: "Live social posting needs connected business accounts." }),
  entry("/ads", "Ad campaign management", "verify-ad-management-control.cjs", [
    "marketing",
    "provider-gated",
    "mutation",
    "protected",
  ], { admin: true, gate: "Live ad sync needs Meta credentials and a paused or low-budget proof." }),
  entry("/ops", "Production operations", "verify-production-ops-readiness.cjs", [
    "production",
    "admin-config",
    "export",
    "protected",
  ], { admin: true }),
  entry("/vendors", "Vendor operations", "verify-operational-audit-trail.cjs", [
    "inventory",
    "reporting",
    "protected",
  ], { admin: true }),
  entry("/waste", "Waste and loss tracking", "verify-operational-audit-trail.cjs", [
    "inventory",
    "form-input",
    "mutation",
    "protected",
  ], { admin: true }),
  entry("/expenses", "Expense approval", "verify-expense-approval-queue.cjs", [
    "approval",
    "form-input",
    "mutation",
    "protected",
  ], { admin: true }),
  entry("/ai-insights", "AI owner insights", "verify-ai-insights-feedback.cjs", [
    "analytics",
    "reporting",
    "mutation",
    "protected",
  ], { admin: true }),
  entry("/purchase-orders", "Purchase order workflow", "verify-action-feedback-hygiene.cjs", [
    "inventory",
    "approval",
    "mutation",
    "protected",
  ], { admin: true }),
  entry("/settings", "Settings, roles and providers", "verify-role-gates.cjs", [
    "admin-config",
    "auth",
    "payment-gated",
    "provider-gated",
    "protected",
  ], { admin: true, gate: "Live credentials remain environment-gated." }),
  entry("/receipt/:orderId", "Customer receipt route", "verify-full-customer-order-e2e.cjs", [
    "tracking",
    "payment-gated",
    "navigation",
  ], { sourceRoute: false, sourcePath: path.join("receipt", "[orderId]", "page.tsx") }),
  entry("/kitchen-ticket/:orderId", "Kitchen ticket route", "verify-counter-kitchen-ticket.cjs", [
    "kitchen",
    "tracking",
    "protected",
  ], { sourceRoute: false, sourcePath: path.join("kitchen-ticket", "[orderId]", "page.tsx") }),
  entry("/purchase-orders/:orderId", "Purchase order detail route", "verify-inventory-command-board.cjs", [
    "inventory",
    "approval",
    "protected",
  ], {
    admin: true,
    sourceRoute: false,
    sourcePath: path.join("(dashboard)", "purchase-orders", "[orderId]", "page.tsx"),
  }),
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function proofWritesArtifact(proofFile, artifactName) {
  const source = read(path.join(e2eDir, proofFile));
  return source.includes(artifactName);
}

function routeQuoted(route) {
  return `"${route}"`;
}

function unique(values) {
  return Array.from(new Set(values));
}

function summarizeBy(values, key) {
  return values.reduce((summary, item) => {
    const value = item[key] || "unknown";
    summary[value] = (summary[value] || 0) + 1;
    return summary;
  }, {});
}

function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });

  const sourceRoutes = publicRoutes.concat(adminRoutes);
  const sourceRouteSet = new Set(sourceRoutes);
  const interactiveProof = read(path.join(e2eDir, "verify-interactive-control-labels.cjs"));
  const safeActionProof = read(path.join(e2eDir, "verify-safe-action-buttons.cjs"));
  const interactiveArtifact = readJson(path.join(artifactsDir, "interactive-control-labels.json"));
  const safeActionArtifact = readJson(path.join(artifactsDir, "safe-action-buttons.json"));

  const duplicateRoutes = unique(routeInventory.map((route) => route.route)).filter(
    (route) => routeInventory.filter((item) => item.route === route).length > 1
  );

  const results = routeInventory.map((route) => {
    const absoluteSourcePath = path.join(appDir, route.sourcePath);
    const proofPath = path.join(e2eDir, route.proof);
    const invalidActionClasses = route.actionClasses.filter((actionClass) => !allowedActionClasses.has(actionClass));
    const sourceControls = interactiveArtifact?.byRoute?.[route.route] || null;

    return {
      ...route,
      sourceExists: fs.existsSync(absoluteSourcePath),
      proofExists: fs.existsSync(proofPath),
      invalidActionClasses,
      sourceControls,
      hasControlArtifactCoverage: !route.sourceRoute || Boolean(sourceControls),
      missingFromInteractiveProof:
        route.sourceRoute && sourceRouteSet.has(route.route) && !interactiveProof.includes(routeQuoted(route.route)),
      missingFromSafeActionProof:
        route.sourceRoute && sourceRouteSet.has(route.route) && !safeActionProof.includes(routeQuoted(route.route)),
    };
  });

  const sourceRouteMismatches = sourceRoutes.filter(
    (route) => !routeInventory.some((item) => item.route === route && item.sourceRoute)
  );
  const missingSource = results.filter((item) => !item.sourceExists);
  const missingProof = results.filter((item) => !item.proofExists);
  const invalidClasses = results.filter((item) => item.invalidActionClasses.length > 0);
  const missingInteractiveProofRoutes = results.filter((item) => item.missingFromInteractiveProof);
  const missingSafeActionProofRoutes = results.filter((item) => item.missingFromSafeActionProof);
  const controlArtifactGaps = results.filter((item) => item.sourceRoute && !item.hasControlArtifactCoverage);

  const latestControlAudit = interactiveArtifact
    ? {
        baseURL: interactiveArtifact.baseURL,
        sourceRoutes: interactiveArtifact.sourceRoutes,
        controlsChecked: interactiveArtifact.controlsChecked,
        missingNames: interactiveArtifact.missingNames?.length || 0,
      }
    : {
        baseURL: "",
        sourceRoutes: 0,
        controlsChecked: 0,
        missingNames: 0,
        note: "Run verify:controls to refresh visible-control counts.",
      };

  const latestSafeActionAudit = safeActionArtifact
    ? {
        baseURL: safeActionArtifact.baseURL,
        sourceRoutes: safeActionArtifact.sourceRoutes,
        clickedCount: safeActionArtifact.clickedCount,
      }
    : {
        baseURL: "",
        sourceRoutes: 0,
        clickedCount: 0,
        note: "Run verify:actions to refresh safe-click counts.",
      };

  const providerGatedRoutes = results.filter((item) => item.actionClasses.includes("provider-gated"));
  const paymentGatedRoutes = results.filter((item) => item.actionClasses.includes("payment-gated"));
  const mutationRoutes = results.filter((item) => item.actionClasses.includes("mutation"));
  const classCounts = results.reduce((summary, item) => {
    for (const actionClass of item.actionClasses) {
      summary[actionClass] = (summary[actionClass] || 0) + 1;
    }
    return summary;
  }, {});

  const report = {
    checkedAt: new Date().toISOString(),
    summary: {
      routeEntries: results.length,
      sourceRoutes: sourceRoutes.length,
      dynamicRoutes: results.filter((item) => !item.sourceRoute).length,
      publicRoutes: publicRoutes.length,
      adminRoutes: adminRoutes.length,
      mutationRoutes: mutationRoutes.length,
      paymentGatedRoutes: paymentGatedRoutes.length,
      providerGatedRoutes: providerGatedRoutes.length,
      uniqueProofFiles: unique(results.map((item) => item.proof)).length,
      latestControlAudit,
      latestSafeActionAudit,
      surfaces: summarizeBy(results, "surface"),
      ownerRoles: summarizeBy(results, "ownerRole"),
      actionClasses: classCounts,
    },
    gates: results
      .filter((item) => item.gate)
      .map((item) => ({ route: item.route, area: item.area, gate: item.gate })),
    gaps: {
      duplicateRoutes,
      sourceRouteMismatches,
      missingSource: missingSource.map((item) => ({ route: item.route, sourcePath: item.sourcePath })),
      missingProof: missingProof.map((item) => ({ route: item.route, proof: item.proof })),
      invalidClasses: invalidClasses.map((item) => ({
        route: item.route,
        invalidActionClasses: item.invalidActionClasses,
      })),
      missingInteractiveProofRoutes: missingInteractiveProofRoutes.map((item) => item.route),
      missingSafeActionProofRoutes: missingSafeActionProofRoutes.map((item) => item.route),
      controlArtifactGaps: controlArtifactGaps.map((item) => item.route),
    },
    routes: results.map((item) => ({
      route: item.route,
      area: item.area,
      surface: item.surface,
      ownerRole: item.ownerRole,
      sourceRoute: item.sourceRoute,
      sourcePath: item.sourcePath,
      proof: item.proof,
      actionClasses: item.actionClasses,
      gate: item.gate,
      sourceControls: item.sourceControls,
    })),
    controlProofs: [
      {
        proof: "verify-interactive-control-labels.cjs",
        artifact: "interactive-control-labels.json",
        exists: fs.existsSync(path.join(e2eDir, "verify-interactive-control-labels.cjs")),
        writesArtifact: proofWritesArtifact("verify-interactive-control-labels.cjs", "interactive-control-labels.json"),
      },
      {
        proof: "verify-safe-action-buttons.cjs",
        artifact: "safe-action-buttons.json",
        exists: fs.existsSync(path.join(e2eDir, "verify-safe-action-buttons.cjs")),
        writesArtifact: proofWritesArtifact("verify-safe-action-buttons.cjs", "safe-action-buttons.json"),
      },
    ],
  };

  fs.writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`);

  assert(duplicateRoutes.length === 0, `Route action inventory has duplicate routes: ${duplicateRoutes.join(", ")}`);
  assert(sourceRouteMismatches.length === 0, `Route action inventory is missing source routes: ${sourceRouteMismatches.join(", ")}`);
  assert(missingSource.length === 0, `Route action inventory has missing source files:\n${missingSource.map((item) => `${item.route}: ${item.sourcePath}`).join("\n")}`);
  assert(missingProof.length === 0, `Route action inventory has missing proof files:\n${missingProof.map((item) => `${item.route}: ${item.proof}`).join("\n")}`);
  assert(invalidClasses.length === 0, `Route action inventory has invalid action classes:\n${invalidClasses.map((item) => `${item.route}: ${item.invalidActionClasses.join(", ")}`).join("\n")}`);
  assert(missingInteractiveProofRoutes.length === 0, `Interactive control proof is missing routes: ${missingInteractiveProofRoutes.map((item) => item.route).join(", ")}`);
  assert(missingSafeActionProofRoutes.length === 0, `Safe action proof is missing routes: ${missingSafeActionProofRoutes.map((item) => item.route).join(", ")}`);
  assert(
    !interactiveArtifact || latestControlAudit.missingNames === 0,
    `Latest control audit still has ${latestControlAudit.missingNames} unlabeled controls.`
  );
  assert(
    !safeActionArtifact || latestSafeActionAudit.clickedCount >= 20,
    `Latest safe action audit clicked only ${latestSafeActionAudit.clickedCount} controls.`
  );

  console.log(
    `Route action inventory passed: ${results.length} routes classified, ${mutationRoutes.length} mutation routes, ${providerGatedRoutes.length} provider-gated routes, ${paymentGatedRoutes.length} payment-gated routes.`
  );
}

main();
