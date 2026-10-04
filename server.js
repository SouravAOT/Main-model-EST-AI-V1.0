import "dotenv/config";

import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import { firebaseReady } from "./services/firebase.js";

import chatRoutes from "./routes/chat.js";
import uploadRoutes from "./routes/upload.js";
import searchRoutes from "./routes/search.js";
import notificationRoutes from "./routes/notifications.js";
import userRoutes from "./routes/user.js";
import featureRoutes from "./routes/features.js";

const app = express();

const PORT = Number(process.env.PORT || 10000);

app.set("trust proxy", 1);

app.use(
  helmet({
    crossOriginResourcePolicy: {
      policy: "cross-origin"
    }
  })
);

const allowedOrigins = (process.env.FRONTEND_URL || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.length === 0) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("CORS origin not allowed."));
    },
    credentials: true
  })
);

app.use(
  express.json({
    limit: "10mb"
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "10mb"
  })
);

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    error: "Too many requests. Please try again shortly."
  }
});

app.use("/api", apiLimiter);

app.get("/", (req, res) => {
  res.json({
    name: "EST AI Backend",
    version: "1.1.0",
    status: "online",
    imageGeneration: false
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "est-ai-backend",
    version: "1.1.0",
    firebase: firebaseReady(),
    imageGeneration: false,
    timestamp: new Date().toISOString()
  });
});

app.use("/api/features", featureRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/user", userRoutes);

app.use((req, res) => {
  res.status(404).json({
    error: "Route not found."
  });
});

app.use((error, req, res, next) => {
  console.error("Unhandled server error:", error);

  if (error.message?.startsWith("CORS")) {
    return res.status(403).json({
      error: "Origin not allowed."
    });
  }

  if (error.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({
      error: "File is too large."
    });
  }

  return res.status(500).json({
    error: "Internal server error."
  });
});

app.listen(PORT, () => {
  console.log(`EST AI Backend running on port ${PORT}`);
});
