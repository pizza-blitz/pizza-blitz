const fs = require("fs");
const path = require("path");

const e2eDir = __dirname;
const artifactsDir = path.join(e2eDir, "artifacts");
const artifactPath = path.join(artifactsDir, "feature-action-coverage.json");

const requirements = [
  {
    area: "Admin access and role gates",
    status: "covered",
    actions: ["Master/admin login", "staff route restrictions", "credential activation readiness"],
    proofs: [
      "verify-role-gates.cjs",
      "verify-admin-credential-command.cjs",
      "verify-credential-activation-command.cjs",
    ],
    artifacts: [
      "visible-role-gates-settings.png",
      "visible-admin-credential-command.png",
      "visible-credential-activation-command.png",
    ],
  },
  {
    area: "Public customer ordering",
    status: "covered",
    actions: ["menu browsing", "cart", "coupon", "checkout", "receipt", "tracking and reorder"],
    proofs: [
      "verify-customer-web-checkout.cjs",
      "verify-full-customer-order-e2e.cjs",
      "verify-product-customization.cjs",
      "verify-track-reorder-loop.cjs",
    ],
    artifacts: [
      "visible-customer-web-checkout.png",
      "visible-full-customer-order-e2e.png",
      "visible-product-customization.png",
      "visible-track-reorder-checkout.png",
    ],
  },
  {
    area: "Counter POS and kitchen handoff",
    status: "covered",
    actions: ["walk-in order", "quick build", "bill/receipt", "KOT", "kitchen ready state"],
    proofs: [
      "verify-counter-order-e2e.cjs",
      "verify-counter-quick-builds.cjs",
      "verify-counter-kitchen-ticket.cjs",
      "verify-kitchen-station-board.cjs",
    ],
    artifacts: [
      "visible-counter-order-e2e.png",
      "visible-counter-quick-builds.png",
      "visible-counter-kitchen-ticket.png",
      "visible-kitchen-station-board.png",
    ],
  },
  {
    area: "Delivery charges, zones and assignment",
    status: "covered",
    actions: ["zone quote", "minimum-order guard", "rider assignment", "dispatch", "customer tracking"],
    proofs: [
      "verify-delivery-charges-zones.cjs",
      "verify-delivery-zone-assignment.cjs",
      "verify-delivery-order-e2e.cjs",
      "verify-customer-delivery-profile.cjs",
    ],
    artifacts: [
      "visible-delivery-charges-zones.png",
      "visible-delivery-zone-assignment.png",
      "visible-delivery-order-e2e.png",
      "visible-customer-delivery-profile-checkout.png",
    ],
  },
  {
    area: "Payments, webhook and settlement",
    status: "provider-gated",
    actions: ["manual proof", "gateway setup", "signed webhook", "counter payment close", "settlement view"],
    proofs: [
      "verify-payment-production-pass.cjs",
      "verify-payment-readiness-webhook.cjs",
      "verify-payment-counter-proof-command.cjs",
      "verify-public-payment-trust-boundary.cjs",
      "verify-direct-bank-settlement-command.cjs",
    ],
    artifacts: [
      "visible-payment-production-pass.png",
      "visible-payment-readiness-webhook.png",
      "visible-payment-counter-proof-command.png",
      "visible-payment-gateway-activation.png",
    ],
    gate: "Needs real gateway/bank credentials and one low-value live transaction.",
  },
  {
    area: "Product, menu and customization controls",
    status: "covered",
    actions: ["sizes", "toppings", "add-ons", "combos", "admin pricing", "kitchen-safe item labels"],
    proofs: [
      "verify-product-customization.cjs",
      "verify-counter-order-e2e.cjs",
      "verify-full-customer-order-e2e.cjs",
    ],
    artifacts: [
      "visible-product-customization-command.png",
      "visible-product-customization.png",
      "visible-counter-order-e2e-pos.png",
    ],
  },
  {
    area: "Campaigns, coupons and customer retention",
    status: "covered",
    actions: ["coupon launch", "segment launch", "send queue", "retention campaign", "offer deep link"],
    proofs: [
      "verify-promotion-launch-bundle.cjs",
      "verify-campaign-sending.cjs",
      "verify-campaign-send-queue.cjs",
      "verify-segment-campaign-launch.cjs",
      "verify-retention-audience-promotions.cjs",
      "verify-campaign-offer-deeplink.cjs",
    ],
    artifacts: [
      "visible-promotion-launch-bundle.png",
      "visible-campaign-sending.png",
      "visible-campaign-send-queue.png",
      "visible-segment-campaign-launch.png",
      "visible-retention-audience-promotions.png",
      "visible-campaign-offer-deeplink.png",
    ],
  },
  {
    area: "WhatsApp, SMS and email sending",
    status: "provider-gated",
    actions: ["template compliance", "consent suppression", "safe test send", "delivery recovery"],
    proofs: [
      "verify-messaging-readiness.cjs",
      "verify-campaign-consent-suppression.cjs",
      "verify-campaign-delivery-recovery.cjs",
      "verify-campaign-cleanup-resend.cjs",
    ],
    artifacts: [
      "visible-messaging-readiness.png",
      "visible-campaign-consent-suppression.png",
      "visible-campaign-delivery-recovery.png",
      "visible-campaign-cleanup-resend.png",
    ],
    gate: "Needs owner-approved provider credentials and a low-risk live send.",
  },
  {
    area: "Social publishing",
    status: "provider-gated",
    actions: ["scheduled post", "retry", "readiness blockers", "mission-control audit"],
    proofs: [
      "verify-social-autoposting.cjs",
      "verify-social-publishing-readiness.cjs",
      "verify-social-autopost-mission-control.cjs",
    ],
    artifacts: [
      "visible-social-autoposting.png",
      "visible-social-publishing-readiness.png",
      "visible-social-autopost-mission-control.png",
    ],
    gate: "Needs connected Facebook/Instagram business credentials before live posting.",
  },
  {
    area: "Ad campaign management",
    status: "provider-gated",
    actions: ["campaign create", "budget pacing", "provider sync", "pause/resume", "duplicate and audit"],
    proofs: [
      "verify-ad-campaign-management.cjs",
      "verify-ad-budget-pacing.cjs",
      "verify-ad-provider-sync.cjs",
      "verify-ad-ops-actions.cjs",
      "verify-ad-management-control.cjs",
    ],
    artifacts: [
      "visible-ad-campaign-management.png",
      "visible-ad-budget-pacing.png",
      "visible-ad-provider-sync.png",
      "visible-ad-ops-actions.png",
      "visible-ad-management-control.png",
    ],
    gate: "Needs Meta Ads credentials and a paused/low-budget provider sync proof.",
  },
  {
    area: "Owner reporting and daily operations",
    status: "covered",
    actions: ["daily close", "cash drawer", "comparison reports", "operational dashboard", "data export"],
    proofs: [
      "verify-daily-close-command.cjs",
      "verify-cash-drawer-command.cjs",
      "verify-reporting-comparison-dashboard.cjs",
      "verify-operational-dashboard-command.cjs",
      "verify-data-quality-export-command.cjs",
    ],
    artifacts: [
      "visible-daily-close-command.png",
      "visible-cash-drawer-command.png",
      "visible-reporting-comparison-dashboard.png",
      "visible-operational-dashboard-command-board.png",
      "visible-data-quality-export-command.png",
    ],
  },
  {
    area: "Inventory, staff, expenses and purchase ops",
    status: "covered",
    actions: ["stock item create", "stock adjustment", "purchase draft", "attendance", "payroll preview", "expense audit"],
    proofs: [
      "verify-inventory-command-board.cjs",
      "verify-employee-attendance-command.cjs",
      "verify-employee-payroll-preview.cjs",
      "verify-expense-audit-command.cjs",
      "verify-expense-approval-queue.cjs",
    ],
    artifacts: [
      "visible-inventory-command-board.png",
      "visible-employee-attendance-command.png",
      "visible-employee-payroll-preview.png",
      "visible-expense-audit-command.png",
      "visible-expense-approval-queue.png",
    ],
  },
  {
    area: "Production database, deployment and backup safety",
    status: "environment-gated",
    actions: ["production DB path", "secret safety", "deployment proof", "logical export", "managed backup", "restore rehearsal"],
    proofs: [
      "verify-production-database-path.cjs",
      "verify-environment-secrets-security.cjs",
      "verify-deployment-pipeline.cjs",
      "verify-logical-backup-proof.cjs",
      "verify-managed-backup-proof-command.cjs",
      "verify-restore-rehearsal-command.cjs",
    ],
    artifacts: [
      "visible-production-database-path.png",
      "visible-environment-secrets-security.png",
      "visible-deployment-pipeline.png",
      "visible-logical-backup-proof.png",
      "visible-managed-backup-proof-actions.png",
    ],
    gate: "Needs a clean restore target and recurring managed backup evidence.",
  },
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function existsIn(directory, fileName) {
  return fs.existsSync(path.join(directory, fileName));
}

function proofWritesArtifact(requirement, artifact) {
  return requirement.proofs.some((proof) => {
    const proofPath = path.join(e2eDir, proof);
    if (!fs.existsSync(proofPath)) return false;
    return fs.readFileSync(proofPath, "utf8").includes(artifact);
  });
}

function unique(values) {
  return Array.from(new Set(values));
}

function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });

  const results = requirements.map((requirement) => {
    const missingProofs = requirement.proofs.filter((proof) => !existsIn(e2eDir, proof));
    const missingArtifacts = requirement.artifacts.filter(
      (artifact) => !existsIn(artifactsDir, artifact) && !proofWritesArtifact(requirement, artifact)
    );
    const pendingArtifacts = requirement.artifacts.filter(
      (artifact) => !existsIn(artifactsDir, artifact) && proofWritesArtifact(requirement, artifact)
    );
    return {
      ...requirement,
      missingProofs,
      missingArtifacts,
      pendingArtifacts,
      proofCount: requirement.proofs.length,
      artifactCount: requirement.artifacts.length,
      ready: missingProofs.length === 0 && missingArtifacts.length === 0,
    };
  });

  const missing = results.filter((result) => !result.ready);
  const providerOrEnvironmentGated = results.filter((result) => result.status !== "covered");
  const allProofs = unique(requirements.flatMap((requirement) => requirement.proofs));
  const allArtifacts = unique(requirements.flatMap((requirement) => requirement.artifacts));
  const proofCoveragePercent = Math.round(((results.length - missing.length) / results.length) * 100);

  const report = {
    checkedAt: new Date().toISOString(),
    summary: {
      requirements: results.length,
      readyRequirements: results.length - missing.length,
      missingRequirements: missing.length,
      proofCoveragePercent,
      uniqueProofFiles: allProofs.length,
      uniqueArtifacts: allArtifacts.length,
      providerOrEnvironmentGates: providerOrEnvironmentGated.length,
    },
    gates: providerOrEnvironmentGated.map((result) => ({
      area: result.area,
      status: result.status,
      gate: result.gate,
    })),
    results,
  };

  fs.writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`);

  assert(
    missing.length === 0,
    `Feature action coverage has missing evidence:\n${missing
      .map(
        (item) =>
          `${item.area}: proofs=${item.missingProofs.join(", ") || "ok"} artifacts=${
            item.missingArtifacts.join(", ") || "ok"
          }`
      )
      .join("\n")}`
  );

  console.log(
    `Feature action coverage passed: ${results.length}/${results.length} areas have proof scripts and artifacts; ${providerOrEnvironmentGated.length} live-provider/environment gates remain.`
  );
}

main();
