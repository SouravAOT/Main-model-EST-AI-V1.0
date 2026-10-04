import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { getDb, FieldValue } from "../services/firebase.js";

const router = express.Router();

router.get("/me", requireAuth, async (req, res) => {
  try {
    const db = getDb();

    const userRef = db.collection("users").doc(req.user.uid);
    const snapshot = await userRef.get();

    if (!snapshot.exists) {
      await userRef.set({
        uid: req.user.uid,
        email: req.user.email,
        name: req.user.name,
        picture: req.user.picture,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });
    }

    const finalSnapshot = await userRef.get();

    return res.json({
      success: true,
      user: {
        id: req.user.uid,
        ...finalSnapshot.data()
      }
    });
  } catch (error) {
    console.error("User profile error:", error);

    return res.status(500).json({
      error: "Unable to load user profile."
    });
  }
});

router.post("/fcm-token", requireAuth, async (req, res) => {
  try {
    const token = String(req.body?.token || "").trim();

    if (!token) {
      return res.status(400).json({
        error: "FCM token is required."
      });
    }

    if (token.length > 4096) {
      return res.status(400).json({
        error: "Invalid FCM token."
      });
    }

    const db = getDb();

    await db
      .collection("users")
      .doc(req.user.uid)
      .set(
        {
          fcmTokens: FieldValue.arrayUnion(token),
          updatedAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      );

    return res.json({
      success: true
    });
  } catch (error) {
    console.error("FCM token error:", error);

    return res.status(500).json({
      error: "Unable to save FCM token."
    });
  }
});

router.patch("/settings", requireAuth, async (req, res) => {
  try {
    const allowed = [
      "voice",
      "language",
      "theme",
      "notificationsEnabled"
    ];

    const settings = {};

    for (const key of allowed) {
      if (req.body && Object.prototype.hasOwnProperty.call(req.body, key)) {
        settings[key] = req.body[key];
      }
    }

    const db = getDb();

    await db
      .collection("users")
      .doc(req.user.uid)
      .set(
        {
          settings,
          updatedAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      );

    return res.json({
      success: true,
      settings
    });
  } catch (error) {
    console.error("Settings error:", error);

    return res.status(500).json({
      error: "Unable to update settings."
    });
  }
});

export default router;
