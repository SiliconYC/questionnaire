import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
const [method, endpoint, bodyFile] = process.argv.slice(2);
if (
  !endpoint?.startsWith("/") ||
  endpoint.startsWith("//") ||
  !["GET", "PUT", "POST", "PATCH", "DELETE"].includes(method)
)
  throw new Error("Invalid GitHub API request");
const credential = spawnSync("git", ["credential", "fill"], {
  input: "protocol=https\nhost=github.com\n\n",
  encoding: "utf8",
});
const fields = Object.fromEntries(
  credential.stdout
    .split("\n")
    .filter((x) => x.includes("="))
    .map((x) => [x.slice(0, x.indexOf("=")), x.slice(x.indexOf("=") + 1)]),
);
if (!fields.password) throw new Error("GitHub credential unavailable");
const response = await fetch("https://api.github.com" + endpoint, {
  method,
  headers: {
    Authorization: "Bearer " + fields.password,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  },
  body: bodyFile ? readFileSync(bodyFile, "utf8") : undefined,
});
const payload = await response.text();
console.log(
  JSON.stringify({
    status: response.status,
    body: payload ? JSON.parse(payload) : null,
  }),
);
if (!response.ok) process.exitCode = 1;
