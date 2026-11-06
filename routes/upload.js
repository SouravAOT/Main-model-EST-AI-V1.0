import express from "express";
import multer from "multer";
import { requireAuth } from "../middleware/auth.js";
import { uploadBuffer } from "../services/cloudinary.js";
import { getDb, FieldValue } from "../services/firebase.js";

const router = express.Router();
const storage = multer.memoryStorage();

const allowedMimeTypes = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "application/pdf", "text/plain", "application/json",
  "video/mp4", "video/webm", "audio/mpeg", "audio/wav", "audio/webm"
]);

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      return callback(new Error(`Unsupported file type: ${file.mimetype}`));
    }
    callback(null, true);
  }
});

// Restore the signed-in user's saved files from Firestore.
router.get("/", requireAuth, async (req, res) => {
  try {
    const snapshot = await getDb()
      .collection("users")
      .doc(req.user.uid)
      .collection("files")
      .orderBy("createdAt", "desc")
      .limit(200)
      .get();

    const files = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        originalName: data.originalName || "Uploaded file",
        mimeType: data.mimeType || "application/octet-stream",
        size: Number(data.size) || 0,
        url: data.url,
        resourceType: data.resourceType || null,
        createdAt: data.createdAt?.toDate
          ? data.createdAt.toDate().toISOString()
          : null
      };
    });

    return res.json({ success: true, files });
  } catch (error) {
    console.error("File listing error:", error);
    return res.status(500).json({ error: "Unable to load saved files." });
  }
});

router.post("/", requireAuth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    const result = await uploadBuffer(req.file.buffer, {
      folder: `est-ai/users/${req.user.uid}`,
      resourceType: "auto"
    });

    const fileRecord = {
      userId: req.user.uid,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      url: result.secure_url,
      publicId: result.public_id,
      resourceType: result.resource_type,
      createdAt: FieldValue.serverTimestamp()
    };

    const fileRef = await getDb()
      .collection("users")
      .doc(req.user.uid)
      .collection("files")
      .add(fileRecord);

    return res.status(201).json({
      success: true,
      file: {
        id: fileRef.id,
        ...fileRecord,
        createdAt: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error("Upload error:", error);
    return res.status(500).json({ error: "File upload failed." });
  }
});

export default router;
