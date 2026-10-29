import http from "node:http";
const port = Number(process.env.LOCAL_GATEWAY_PORT || 58000),
  auth = process.env.LOCAL_AUTH_ORIGIN || "http://127.0.0.1:59999",
  fn = process.env.LOCAL_FUNCTION_ORIGIN || "http://127.0.0.1:59000";
const server = http.createServer(async (req, res) => {
  try {
    const cors = {
      "access-control-allow-origin":
        req.headers.origin || "http://127.0.0.1:58001",
      "access-control-allow-headers":
        "authorization,apikey,content-type,x-client-info,x-supabase-api-version",
      "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "access-control-expose-headers": "x-supabase-api-version",
    };
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors).end();
      return;
    }
    const incoming = new URL(req.url || "/", "http://local");
    let target, path;
    if (incoming.pathname.startsWith("/auth/v1")) {
      target = auth;
      path = incoming.pathname.slice("/auth/v1".length) || "/";
    } else if (incoming.pathname === "/functions/v1/student-identity") {
      target = fn;
      path = "/";
    } else {
      res.writeHead(404, cors).end("not found");
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const upstream = await fetch(new URL(path + incoming.search, target), {
      method: req.method,
      headers: Object.fromEntries(
        Object.entries(req.headers).filter(
          ([k]) => !["host", "content-length", "origin"].includes(k),
        ),
      ),
      body: ["GET", "HEAD"].includes(req.method || "GET")
        ? undefined
        : Buffer.concat(chunks),
      redirect: "manual",
    });
    res.writeHead(upstream.status, {
      ...Object.fromEntries(upstream.headers),
      ...cors,
    });
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    res.writeHead(502).end("local gateway error");
  }
});
server.listen(port, "0.0.0.0", () =>
  console.log(`synthetic local gateway listening on ${port}`),
);
