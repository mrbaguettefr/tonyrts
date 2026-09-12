import { startServer } from "./server";
const server = await startServer({
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? "0.0.0.0",
});
console.log(
  `Iron Orbit multiplayer listening on http://localhost:${server.port}`,
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void server.close().then(() => process.exit(0));
  });
