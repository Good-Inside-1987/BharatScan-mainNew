import http from "http";

const TARGET_PORT = 5000;
const PROXY_PORT = 22167;

const server = http.createServer((req, res) => {
  const options = {
    hostname: "localhost",
    port: TARGET_PORT,
    path: req.url,
    method: req.method,
    headers: req.headers,
  };

  const proxy = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxy.on("error", () => {
    res.writeHead(502);
    res.end("App not ready yet");
  });

  req.pipe(proxy);
});

server.listen(PROXY_PORT, "0.0.0.0", () => {
  console.log(`Proxy: port ${PROXY_PORT} → localhost:${TARGET_PORT}`);
});
