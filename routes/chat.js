import express from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  getDb,
  FieldValue
} from "../services/firebase.js";
import {
  generateChatResponse,
  isImageGenerationRequest
} from "../services/groq.js";
import {
  searchWeb,
  formatSearchContext
} from "../services/search.js";

const router = express.Router();

function cleanText(value, max = 20000) {
  return String(value || "").trim().slice(0, max);
}

async function getOrCreateChat(uid, chatId, firstMessage) {
  const db = getDb();

  if (chatId) {
    const ref = db.collection("chats").doc(chatId);
    const snapshot = await ref.get();

    if (!snapshot.exists) {
      throw new Error("Chat not found.");
    }

    if (snapshot.data()?.userId !== uid) {
      throw new Error("Unauthorized chat access.");
    }

    return ref;
  }

  const title =
    firstMessage.length > 60
      ? `${firstMessage.slice(0, 57)}...`
      : firstMessage || "New Chat";

  return db.collection("chats").add({
    userId: uid,
    title,
    pinned: false,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });
}

async function getRecentMessages(chatRef) {
  const snapshot = await chatRef
    .collection("messages")
    .orderBy("createdAt", "desc")
    .limit(30)
    .get();

  return snapshot.docs
    .reverse()
    .map((doc) => ({
      id: doc.id,
      role: doc.data().role,
      content: doc.data().content
    }));
}

router.post("/", requireAuth, async (req, res) => {
  try {
    const message = cleanText(req.body?.message);

    if (!message) {
      return res.status(400).json({
        error: "Message is required."
      });
    }

    if (isImageGenerationRequest(message)) {
      return res.json({
        success: true,
        available: false,
        type: "image_generation",
        message: "image generation is not available in v1.1."
      });
    }

    const chatId = cleanText(req.body?.chatId, 200) || null;
    const useWebSearch = Boolean(req.body?.webSearch);

    const chatRef = await getOrCreateChat(
      req.user.uid,
      chatId,
      message
    );

    const db = getDb();

    await chatRef.collection("messages").add({
      userId: req.user.uid,
      role: "user",
      content: message,
      createdAt: FieldValue.serverTimestamp()
    });

    const conversation = await getRecentMessages(chatRef);

    let webContext = null;
    let searchResults = [];

    if (useWebSearch) {
      try {
        const searchResponse = await searchWeb(message, {
          language: req.body?.language || "auto"
        });

        searchResults = searchResponse.results || [];
        webContext = formatSearchContext(searchResults);
      } catch (searchError) {
        console.warn(
          "Web search unavailable:",
          searchError.message
        );
      }
    }

    const aiResponse = await generateChatResponse({
      messages: conversation,
      webContext
    });

    await chatRef.collection("messages").add({
      userId: req.user.uid,
      role: "assistant",
      content: aiResponse.text,
      model: aiResponse.model,
      createdAt: FieldValue.serverTimestamp()
    });

    await chatRef.update({
      updatedAt: FieldValue.serverTimestamp()
    });

    return res.json({
      success: true,
      chatId: chatRef.id,
      message: {
        role: "assistant",
        content: aiResponse.text,
        model: aiResponse.model
      },
      webSearch: {
        used: useWebSearch && searchResults.length > 0,
        results: searchResults
      }
    });
  } catch (error) {
    console.error("Chat error:", error);

    const status =
      error.message === "Unauthorized chat access."
        ? 403
        : error.message === "Chat not found."
        ? 404
        : 500;

    return res.status(status).json({
      error: "Unable to process your message."
    });
  }
});

router.get("/:chatId/messages", requireAuth, async (req, res) => {
  try {
    const db = getDb();

    const chatRef = db
      .collection("chats")
      .doc(req.params.chatId);

    const chatSnapshot = await chatRef.get();

    if (!chatSnapshot.exists) {
      return res.status(404).json({
        error: "Chat not found."
      });
    }

    if (chatSnapshot.data()?.userId !== req.user.uid) {
      return res.status(403).json({
        error: "Unauthorized."
      });
    }

    const snapshot = await chatRef
      .collection("messages")
      .orderBy("createdAt", "asc")
      .limit(200)
      .get();

    const messages = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data()
    }));

    return res.json({
      success: true,
      chatId: chatRef.id,
      messages
    });
  } catch (error) {
    console.error("Messages error:", error);

    return res.status(500).json({
      error: "Unable to load messages."
    });
  }
});

router.get("/", requireAuth, async (req, res) => {
  try {
    const db = getDb();

    const snapshot = await db
      .collection("chats")
      .where("userId", "==", req.user.uid)
      .orderBy("updatedAt", "desc")
      .limit(50)
      .get();

    const chats = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data()
    }));

    return res.json({
      success: true,
      chats
    });
  } catch (error) {
    console.error("Chats error:", error);

    return res.status(500).json({
      error: "Unable to load conversations."
    });
  }
});

router.patch("/:chatId", requireAuth, async (req, res) => {
  try {
    const db = getDb();

    const chatRef = db
      .collection("chats")
      .doc(req.params.chatId);

    const snapshot = await chatRef.get();

    if (!snapshot.exists) {
      return res.status(404).json({
        error: "Chat not found."
      });
    }

    if (snapshot.data()?.userId !== req.user.uid) {
      return res.status(403).json({
        error: "Unauthorized."
      });
    }

    const updates = {};

    if (typeof req.body?.title === "string") {
      updates.title = req.body.title.trim().slice(0, 150);
    }

    if (typeof req.body?.pinned === "boolean") {
      updates.pinned = req.body.pinned;
    }

    updates.updatedAt = FieldValue.serverTimestamp();

    await chatRef.update(updates);

    return res.json({
      success: true
    });
  } catch (error) {
    console.error("Chat update error:", error);

    return res.status(500).json({
      error: "Unable to update conversation."
    });
  }
});

router.delete("/:chatId", requireAuth, async (req, res) => {
  try {
    const db = getDb();

    const chatRef = db
      .collection("chats")
      .doc(req.params.chatId);

    const snapshot = await chatRef.get();

    if (!snapshot.exists) {
      return res.status(404).json({
        error: "Chat not found."
      });
    }

    if (snapshot.data()?.userId !== req.user.uid) {
      return res.status(403).json({
        error: "Unauthorized."
      });
    }

    const messages = await chatRef
      .collection("messages")
      .get();

    const batch = db.batch();

    messages.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });

    batch.delete(chatRef);

    await batch.commit();

    return res.json({
      success: true
    });
  } catch (error) {
    console.error("Chat delete error:", error);

    return res.status(500).json({
      error: "Unable to delete conversation."
    });
  }
});

export default router;
