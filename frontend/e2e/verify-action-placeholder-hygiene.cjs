const fs = require("fs");
const path = require("path");

const frontendRoot = path.resolve(__dirname, "..");
const sourceRoots = [
  path.join(frontendRoot, "src", "app"),
  path.join(frontendRoot, "src", "components"),
];
const artifactsDir = path.join(__dirname, "artifacts");
const artifactPath = path.join(artifactsDir, "action-placeholder-hygiene.json");

const filePatterns = new Set([".ts", ".tsx"]);
const bannedPatterns = [
  {
    id: "browser-alert",
    pattern: /\b(?:window\.)?alert\s*\(/,
    reason: "Use inline action feedback instead of blocking browser popups.",
  },
  {
    id: "inert-hash-link",
    pattern: /href=\{?["']#["']\}?/,
    reason: "Use a disabled button or a real destination instead of an inert hash link.",
  },
  {
    id: "javascript-link",
    pattern: /javascript:/i,
    reason: "Use React event handlers or real links instead of javascript: URLs.",
  },
  {
    id: "coming-soon-copy",
    pattern: /\bcoming soon\b/i,
    reason: "Visible placeholder copy makes the feature look unfinished.",
  },
  {
    id: "not-implemented-copy",
    pattern: /\bnot implemented\b/i,
    reason: "Visible placeholder copy makes the feature look unfinished.",
  },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function walk(directory, files = []) {
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
    } else if (filePatterns.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

function relative(filePath) {
  return path.relative(frontendRoot, filePath).replace(/\\/g, "/");
}

function scanFile(filePath) {
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  const findings = [];

  lines.forEach((line, index) => {
    for (const banned of bannedPatterns) {
      if (banned.pattern.test(line)) {
        findings.push({
          file: relative(filePath),
          line: index + 1,
          id: banned.id,
          reason: banned.reason,
          text: line.trim(),
        });
      }
    }
  });

  return findings;
}

function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  const files = sourceRoots.flatMap((root) => walk(root));
  const findings = files.flatMap(scanFile);

  const report = {
    checkedAt: new Date().toISOString(),
    sourceFilesChecked: files.length,
    bannedPatternCount: bannedPatterns.length,
    findings,
  };

  fs.writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`);

  assert(
    findings.length === 0,
    `Action placeholder hygiene found ${findings.length} issue(s):\n${findings
      .slice(0, 25)
      .map((finding) => `${finding.file}:${finding.line} ${finding.id} - ${finding.text}`)
      .join("\n")}`
  );

  console.log(
    `Action placeholder hygiene passed: ${files.length} source files checked for alerts, inert links and unfinished action copy.`
  );
}

main();
