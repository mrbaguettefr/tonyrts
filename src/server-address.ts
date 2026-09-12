/** Normalize an explicitly selected game server while respecting browser security. */
export function resolveGameServer(input: string, origin: string): string {
  const page = new URL(origin);
  if (!input.trim() && page.hostname.endsWith(".github.io"))
    throw new Error(
      "Enter a multiplayer server address. GitHub Pages hosts the game client only.",
    );
  const url = new URL(input.trim() || "/multiplayer", page);
  if (url.protocol === "http:") url.protocol = "ws:";
  if (url.protocol === "https:") url.protocol = "wss:";
  if (url.protocol !== "ws:" && url.protocol !== "wss:")
    throw new Error("Use an http, https, ws, or wss game server address.");
  if (url.username || url.password)
    throw new Error(
      "Game server addresses must not include a username or password.",
    );
  if (page.protocol === "https:" && url.protocol !== "wss:")
    throw new Error(
      "This secure page requires an HTTPS/WSS multiplayer server.",
    );
  if (url.pathname === "/") url.pathname = "/multiplayer";
  url.hash = "";
  return url.href;
}
