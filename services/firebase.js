import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

let firebaseApp;

function initializeFirebase() {
  if (getApps().length > 0) {
    firebaseApp = getApps()[0];
    return firebaseApp;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    console.warn(
      "Firebase Admin credentials are missing. Firebase-dependent routes will not work."
    );
    return null;
  }

  firebaseApp = initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey
    })
  });

  return firebaseApp;
}

initializeFirebase();

export function firebaseReady() {
  return Boolean(firebaseApp);
}

export function getFirebaseAuth() {
  if (!firebaseApp) {
    throw new Error("Firebase Admin is not configured.");
  }

  return getAuth(firebaseApp);
}

export function getDb() {
  if (!firebaseApp) {
    throw new Error("Firebase Admin is not configured.");
  }

  return getFirestore(firebaseApp);
}

export function getFirebaseMessaging() {
  if (!firebaseApp) {
    throw new Error("Firebase Admin is not configured.");
  }

  return getMessaging(firebaseApp);
}

export { FieldValue };
