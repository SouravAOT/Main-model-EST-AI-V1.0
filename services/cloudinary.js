
import { v2 as cloudinary } from "cloudinary";

let configured = false;

function configureCloudinary() {
  if (configured) return;

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_SECRET_API_KEY;

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error(
      "Cloudinary environment variables are missing."
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
        ...(options.publicId
          ? { public_id: options.publicId }
          : {}),
        overwrite: false
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(result);
      }
    );

    uploadStream.end(buffer);
  });
}

export { cloudinary };
