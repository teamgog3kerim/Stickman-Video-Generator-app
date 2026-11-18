import express, { type Express } from "express";
import path from "node:path";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

if (process.env.SERVE_WEB === "true" || process.env.NODE_ENV === "production") {
  const webRoot = path.resolve(
    process.cwd(),
    "artifacts/stickman-director/dist/public",
  );
  app.use(express.static(webRoot));
  app.use((req, res, next) => {
    if (
      (req.method === "GET" || req.method === "HEAD") &&
      !req.path.startsWith("/api")
    ) {
      res.sendFile(path.join(webRoot, "index.html"), (error) => {
        if (error) next(error);
      });
      return;
    }
    next();
  });
}

export default app;
