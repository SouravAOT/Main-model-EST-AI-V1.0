import { v2 as cloudinary } from "cloudinary";

let configured = false;

function readCloudinaryCredentials() {
  const cloudUrl = process.env.CLOUDINARY_URL;
  if (cloudUrl) {
    try {
      const parsed = new URL(cloudUrl);
      if (parsed.protocol === "cloudinary:") {
        return {
          cloudName: parsed.hostname,
          apiKey: decodeURIComponent(parsed.username),
          apiSecret: decodeURIComponent(parsed.password)
        };
      }
    } catch (error) {
      throw new Error("CLOUDINARY_URL is invalid.");
    }
  }

  return {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET || process.env.CLOUDINARY_SECRET_API_KEY
  };
}

function configureCloudinary() {
  if (configured) return;

  const { cloudName, apiKey, apiSecret } = readCloudinaryCredentials();
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error(
      "Cloudinary configuration is incomplete. Set CLOUDINARY_URL or CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET."
    );
  }

  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true
  });

  configured = true;
}

export function uploadBuffer(buffer, options = {}) {
  configureCloudinary();

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: options.folder || "est-ai",
        resource_type: options.resourceType || "auto",
        ...(options.publicId ? { public_id: options.publicId } : {}),
        overwrite: false
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );

    uploadStream.end(buffer);
  });
}

export { cloudinary };
