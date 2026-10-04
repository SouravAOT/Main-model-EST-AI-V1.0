import {
  getFirebaseMessaging,
  getDb,
  FieldValue
} from "./firebase.js";

export async function sendNotificationToUser({
  uid,
  title,
  body,
  data = {}
}) {
  const db = getDb();

  const userRef = db.collection("users").doc(uid);
  const userSnapshot = await userRef.get();

  if (!userSnapshot.exists) {
    throw new Error("User not found.");
  }

  const userData = userSnapshot.data() || {};
  const tokens = Array.isArray(userData.fcmTokens)
    ? userData.fcmTokens.filter(Boolean)
    : [];

  if (tokens.length === 0) {
    return {
      sent: false,
      reason: "No FCM tokens registered."
    };
  }

  const messaging = getFirebaseMessaging();

  const messages = tokens.slice(0, 500).map((token) => ({
    token,
    notification: {
      title: String(title).slice(0, 100),
      body: String(body).slice(0, 300)
    },
    data: Object.fromEntries(
      Object.entries(data).map(([key, value]) => [
        String(key),
        String(value)
      ])
    )
  }));

  const response = await messaging.sendEach(messages);

  const invalidTokens = [];

  response.responses.forEach((result, index) => {
    if (!result.success) {
      const code = result.error?.code || "";

      if (
        code.includes("registration-token-not-registered") ||
        code.includes("invalid-registration-token")
      ) {
        invalidTokens.push(tokens[index]);
      }
    }
  });

  if (invalidTokens.length > 0) {
    await userRef.update({
      fcmTokens: FieldValue.arrayRemove(...invalidTokens)
    });
  }

  return {
    sent: true,
    successCount: response.successCount,
    failureCount: response.failureCount
  };
}
