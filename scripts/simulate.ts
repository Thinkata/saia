import "dotenv/config";
import http from "http";

const PORT = Number(process.env.PORT || 3000);

const prompts = [
  "Write a haiku about the ocean.",
  "Fix this TypeScript bug.",
  "Suggest an API design for a todo app.",
  "Compose a short poem about autumn.",
  "Explain how to write unit tests in Jest.",
  "Tell a creative metaphor for learning.",
  "Debug an error in a Node.js server.",
  "Draft a story opening about space travel.",
  "Describe Big-O of binary search.",
  "Write a limerick about code.",
];

function postAct(prompt: string): Promise<void> {
  return new Promise((resolve) => {
    const data = JSON.stringify({ prompt });
    const req = http.request({ hostname: "localhost", port: PORT, path: "/act", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } }, (res) => {
      res.resume();
      res.on("end", resolve);
    });
    req.on("error", () => resolve());
    req.write(data);
    req.end();
  });
}

async function main() {
  console.log(`Simulating 20 requests to http://localhost:${PORT}/act ...`);
  for (let i = 0; i < 20; i++) {
    const p = prompts[i % prompts.length];
    await postAct(p);
  }
  const metricsReq = http.request({ hostname: "localhost", port: PORT, path: "/metrics/detailed", method: "GET" }, (res) => {
    let body = "";
    res.setEncoding("utf8");
    res.on("data", (chunk) => (body += chunk));
    res.on("end", () => {
      console.log("\nDetailed metrics after simulation:\n");
      try { console.log(JSON.stringify(JSON.parse(body), null, 2)); } catch { console.log(body); }
    });
  });
  metricsReq.on("error", (err) => console.error("metrics error", err));
  metricsReq.end();
}

main().catch((e) => console.error(e));


