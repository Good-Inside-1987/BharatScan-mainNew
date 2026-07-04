import express from "express";
import cors from "cors";
import { db } from "./db.js";
import scansRouter from "./routes/scans.js";
import settingsRouter from "./routes/settings.js";
import portfolioRouter from "./routes/portfolio.js";
import dashboardsRouter from "./routes/dashboards.js";
import scannerDashboardsRouter from "./routes/scannerDashboards.js";
import alertsRouter from "./routes/alerts.js";
import paperTradingRouter from "./routes/paperTrading.js";

const app = express();
const port = Number(process.env.SERVER_PORT ?? 3001);

app.use(cors());
app.use(express.json());

app.use("/api/scans", scansRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/portfolio", portfolioRouter);
app.use("/api/dashboards", dashboardsRouter);
app.use("/api/scanner-dashboards", scannerDashboardsRouter);
app.use("/api/alerts", alertsRouter);
app.use("/api/paper-trading", paperTradingRouter);

app.get("/api/health", (_req, res) => {
  const meta = db
    .prepare("SELECT value FROM app_meta WHERE key = ?")
    .get("db_version") as { value: string } | undefined;
  res.json({ status: "ok", db_version: meta?.value ?? "unknown" });
});

app.listen(port, () => {
  console.log(`BharatScan server running on http://localhost:${port}`);
});
