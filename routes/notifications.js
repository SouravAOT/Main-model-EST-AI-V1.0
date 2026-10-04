import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { sendNotificationToUser } from "../services/notifications.js";

const router = express.Router();

router.post("/test", requireAuth, async (req, res) => {
  try {
    const result = await sendNotificationToUser({
      uid: req.user.uid,
      title: "EST AI",
      body: "Aaj kya karna hai? Coding ya kuch aur?",
      data: {
        type: "test"
      }
    });

    return res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error("Notification error:", error);

    return res.status(500).json({
      error: "Unable to send notification."
    });
  }
});

export default router;
