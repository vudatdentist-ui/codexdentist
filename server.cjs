const http = require("node:http");
const next = require("next");

const hostname = process.env.HOSTNAME || "127.0.0.1";
const port = Number(process.env.PORT || 3000);
const app = next({ dev: false, hostname, port });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    http
      .createServer((request, response) => handle(request, response))
      .listen(port, hostname);
  })
  .catch((error) => {
    console.error("Unable to start Codexdentist.", error);
    process.exit(1);
  });
