const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const sourceRoot = path.join(projectRoot, "src");
const artifactsDir = path.join(__dirname, "artifacts");
const artifactPath = path.join(artifactsDir, "source-text-hygiene.json");

const extensions = new Set([".ts", ".tsx", ".css"]);
const mojibakePattern = new RegExp(
  [
    "\\uFFFD",
    "\\u00C3",
    "\\u00C2",
    "\\u00E2\\u20AC",
    "\\u00E2\\u201A\\u00B9",
    "\\u00E2\\u0153",
    "\\u00E2\\u2013",
    "\\u00E2\\u2014",
    "\\u00F0\\u0178",
    "\\u00EF\\u00BF\\u00BD",
  ].join("|")
);
const emojiPattern = /[\u{1F300}-\u{1FAFF}]/u;

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    return extensions.has(path.extname(entry.name)) ? [fullPath] : [];
  });
}

function lineNumberFor(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function snippetFor(text, index) {
  const lineStart = text.lastIndexOf("\n", index) + 1;
  const lineEnd = text.indexOf("\n", index);
  return text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim();
}

function collectIssue(filePath, text, pattern, type) {
  const match = pattern.exec(text);
  if (!match) return null;
  return {
    type,
    file: path.relative(projectRoot, filePath).replace(/\\/g, "/"),
    line: lineNumberFor(text, match.index),
    snippet: snippetFor(text, match.index),
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });

  const files = walk(sourceRoot);
  const issues = [];
  for (const filePath of files) {
    const text = fs.readFileSync(filePath, "utf8");
    const mojibakeIssue = collectIssue(filePath, text, mojibakePattern, "mojibake");
    const emojiIssue = collectIssue(filePath, text, emojiPattern, "emoji-ui-text");
    if (mojibakeIssue) issues.push(mojibakeIssue);
    if (emojiIssue) issues.push(emojiIssue);
  }

  const report = {
    checkedAt: new Date().toISOString(),
    sourceRoot: path.relative(projectRoot, sourceRoot).replace(/\\/g, "/"),
    filesChecked: files.length,
    issues,
  };
  fs.writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`);

  assert(
    issues.length === 0,
    `Source text hygiene found ${issues.length} issue(s):\n${issues
      .map((issue) => `${issue.type} ${issue.file}:${issue.line} ${issue.snippet}`)
      .join("\n")}`
  );

  console.log(`Source text hygiene passed: ${files.length} frontend source files checked.`);
}

main();
