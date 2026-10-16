const express = require("express");
const os = require("os");

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.json({
    service: "node-app",
    language: "Node.js",
    message: "Hello from Node.js! \u{1F7E2}",
    hostname: os.hostname(),
    node: process.version,
    time: new Date().toISOString(),
  });
});

app.get("/healthz", (req, res) => {
  res.json({ status: "ok", service: "node-app" });
});

app.listen(PORT, () => console.log(`node-app running on port ${PORT}`));
