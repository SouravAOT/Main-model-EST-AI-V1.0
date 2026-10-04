import { v2 as cloudinary } from "cloudinary";

let configured = false;

function configureCloudinary() {
  if (configured) return;

  if (!process.env.CLOUDINARY_URL) {
    throw new Error("CLOUDINARY_URL is not configured.");
  }

  cloudinary.config({
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
        public_id: options.publicId,
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
