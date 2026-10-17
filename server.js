
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
import voiceRoutes from "./routes/voice.js";

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
      if (!origin || allowedOrigins.length === 0) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      const error = new Error("CORS origin not allowed.");
      return callback(error);
    },
    credentials: true
  })
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    error: "Too many requests. Please try again shortly."
  }
});

app.use("/api", apiLimiter);

app.get("/", (req, res) => {
  res.json({
    name: "EST AI Backend",
    version: "2.0.0",
    status: "online"
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "est-ai-backend",
    version: "2.0.0",
    firebase: firebaseReady(),
    timestamp: new Date().toISOString()
  });
});

// Existing EST AI API routes
app.use("/api/features", featureRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/user", userRoutes);

// Voice Call API routes
app.use("/api/voice", voiceRoutes);

// Compatibility alias for older frontend requests
app.use("/api/voice-call", voiceRoutes);

// Helpful 404 response
app.use((req, res) => {
  const isVoiceRoute =
    req.path.startsWith("/api/voice") ||
    req.path.startsWith("/api/voice-call");

  res.status(404).json({
    success: false,
    error: "Route not found.",
    method: req.method,
    path: req.originalUrl,
    hint: isVoiceRoute
      ? "Check the voice route and frontend API endpoint."
      : "Check the API path and HTTP method."
  });
});

// Central error handler
app.use((error, req, res, next) => {
  console.error("Unhandled server error:", error);

  if (error.message?.startsWith("CORS")) {
    return res.status(403).json({
      success: false,
      error: "Origin not allowed."
    });
  }

  if (error.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({
      success: false,
      error: "File is too large."
    });
  }

  if (error.status === 400 || error.status === 413) {
    return res.status(error.status).json({
      success: false,
      error: error.message || "Invalid request."
    });
  }

  return res.status(500).json({
    success: false,
    error: "Internal server error."
  });
});

app.listen(PORT, () => {
  console.log(`EST AI Backend v2.0.0 running on port ${PORT}`);
});
                    
