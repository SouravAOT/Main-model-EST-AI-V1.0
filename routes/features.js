import express from "express";

const router = express.Router();

const features = {
  version: "1.1",

  chat: {
    enabled: true
  },

  webSearch: {
    enabled: true
  },

  fileUpload: {
    enabled: true
  },

  cloudStorage: {
    enabled: true,
    provider: "cloudinary"
  },

  notifications: {
    enabled: true,
    provider: "firebase-cloud-messaging"
  },

  imageGeneration: {
    enabled: false,
    message: "image generation is not available in v1.1."
  },

  imageEditing: {
    enabled: false,
    message: "image generation is not available in v1.1."
  },

  hashtags: {
    enabled: true,
    imageGenerationPresetsEnabled: false
  }
};

router.get("/", (req, res) => {
  res.json({
    success: true,
    features
  });
});

export default router;
