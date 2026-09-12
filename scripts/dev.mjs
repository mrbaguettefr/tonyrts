import { spawn } from "node:child_process";
const children = [
  spawn(process.execPath, ["--import", "tsx", "server/main.ts"], {
    stdio: "inherit",
    env: { ...process.env, PORT: "8787" },
  }),
  spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "--host",
      "0.0.0.0",
      ...process.argv.slice(2),
    ],
    { stdio: "inherit" },
  ),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code;
}
for (const child of children) {
  child.on("error", (error) => {
    console.error(error);
    stop(1);
  });
  child.on("exit", (code) => stop(code || 0));
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
