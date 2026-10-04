import { getFirebaseAuth, firebaseReady } from "../services/firebase.js";

export async function requireAuth(req, res, next) {
  try {
    if (!firebaseReady()) {
      return res.status(503).json({
        error: "Firebase authentication is not configured."
      });
    }

    const authorization = req.headers.authorization || "";

    if (!authorization.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Authentication required."
      });
    }

    const token = authorization.substring(7).trim();

    if (!token) {
      return res.status(401).json({
        error: "Invalid authentication token."
      });
    }

    const decodedToken = await getFirebaseAuth().verifyIdToken(token);

    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email || null,
      name: decodedToken.name || null,
      picture: decodedToken.picture || null
    };

    next();
  } catch (error) {
    console.error("Auth error:", error.message);

    return res.status(401).json({
      error: "Invalid or expired authentication token."
    });
  }
      }
