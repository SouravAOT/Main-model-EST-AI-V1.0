import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { searchWeb } from "../services/search.js";

const router = express.Router();

router.post("/", requireAuth, async (req, res) => {
  try {
    const query = String(req.body?.query || "").trim();

    if (!query) {
      return res.status(400).json({
        error: "Search query is required."
      });
    }

    if (query.length > 500) {
      return res.status(400).json({
        error: "Search query is too long."
      });
    }

    const result = await searchWeb(query, {
      language: req.body?.language || "auto"
    });

    return res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error("Search error:", error);

    return res.status(502).json({
      error: "Web search is temporarily unavailable."
    });
  }
});

export default router;
