import express from "express";
import multer from "multer";
import { requireAuth } from "../middleware/auth.js";
import { uploadBuffer } from "../services/cloudinary.js";
import { getDb, FieldValue } from "../services/firebase.js";

const router = express.Router();

const storage = multer.memoryStorage();

const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "application/json",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/wav",
  "audio/webm"
]);

const upload = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024,
    files: 1
  },
  fileFilter: (req, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      return callback(
        new Error(`Unsupported file type: ${file.mimetype}`)
      );
    }

    callback(null, true);
  }
});

router.post(
  "/",
  requireAuth,
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          error: "No file uploaded."
        });
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

      const db = getDb();

      const fileRef = await db
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

      return res.status(500).json({
        error: "File upload failed."
      });
    }
  }
);

export default router;
