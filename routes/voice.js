
import express from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  firebaseReady,
  getDb,
  FieldValue
} from "../services/firebase.js";

const router = express.Router();

const MAX_STALE_SESSION_MS = 6 * 60 * 60 * 1000;

const MAX_MINUTES = {
  free: 180,
  lite: 240,
  pro: 300,
  plus: Infinity
};

function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function getRefs(uid, day = dayKey()) {
  const user = getDb().collection("users").doc(uid);

  return {
    user,
    usage: user.collection("voiceUsage").doc(day),
    current: user.collection("voiceSessions").doc("current")
  };
}

function getActivePlan(userData = {}, now = Date.now()) {
  const subscription = userData.subscription || {};
  const plan = String(subscription.plan || "free").toLowerCase();
  const expiresAt = Number(subscription.expiresAtMs || 0);

  if (!expiresAt || expiresAt <= now) {
    return "free";
  }

  return ["lite", "pro", "plus"].includes(plan)
    ? plan
    : "free";
}

function buildQuota(plan, usedMs, liveElapsedMs = 0) {
  const maximum = MAX_MINUTES[plan] ?? MAX_MINUTES.free;
  const used = Math.max(0, Number(usedMs) || 0)
    + Math.max(0, Number(liveElapsedMs) || 0);

  const limitMs = Number.isFinite(maximum)
    ? maximum * 60_000
    : null;

  const remainingMs = limitMs === null
    ? null
    : Math.max(0, limitMs - used);

  return {
    plan,
    usedMs: used,
    limitMs,
    remainingMs,
    unlimited: limitMs === null,
    allowed: limitMs === null || remainingMs > 0
  };
}

function requireFirebase(res) {
  if (!firebaseReady()) {
    res.status(503).json({
      success: false,
      error: "Firebase is not configured on the server."
    });

    return false;
  }

  return true;
}

// Route test: GET /api/voice/
router.get("/", (req, res) => {
  res.json({
    success: true,
    service: "EST AI Voice Call",
    status: "available",
    routes: [
      "GET /api/voice/status",
      "POST /api/voice/start",
      "POST /api/voice/end"
    ]
  });
});

// Check daily voice usage
router.get("/status", requireAuth, async (req, res) => {
  if (!requireFirebase(res)) return;

  try {
    const now = Date.now();
    const { user, usage, current } = getRefs(req.user.uid);

    const [userSnap, usageSnap, sessionSnap] = await Promise.all([
      user.get(),
      usage.get(),
      current.get()
    ]);

    const plan = getActivePlan(userSnap.data() || {});
    const usedMs = Math.max(
      0,
      Number(usageSnap.data()?.usedMs) || 0
    );

    const session = sessionSnap.data() || {};

    const liveElapsed =
      session.active &&
      session.dayKey === dayKey(new Date(now))
        ? Math.max(0, now - Number(session.startedAtMs || now))
        : 0;

    res.json({
      success: true,
      ...buildQuota(plan, usedMs, liveElapsed),
      day: dayKey(new Date(now)),
      active: Boolean(session.active)
    });
  } catch (error) {
    console.error("Voice status error:", error.message);

    res.status(500).json({
      success: false,
      error: "Could not check voice usage."
    });
  }
});

// Start a voice session
router.post("/start", requireAuth, async (req, res) => {
  if (!requireFirebase(res)) return;

  try {
    const now = Date.now();
    const today = dayKey(new Date(now));
    const { user, usage, current } = getRefs(req.user.uid);

    let result;

    await getDb().runTransaction(async (tx) => {
      const [userSnap, usageSnap, sessionSnap] = await Promise.all([
        tx.get(user),
        tx.get(usage),
        tx.get(current)
      ]);

      const plan = getActivePlan(userSnap.data() || {});
      let usedMs = Math.max(
        0,
        Number(usageSnap.data()?.usedMs) || 0
      );

      const session = sessionSnap.data() || {};

      if (session.active && Number(session.startedAtMs) > 0) {
        const elapsed = Math.max(
          0,
          now - Number(session.startedAtMs)
        );

        if (
          elapsed <= MAX_STALE_SESSION_MS &&
          session.dayKey === today
        ) {
          result = {
            ...buildQuota(plan, usedMs, elapsed),
            day: today,
            active: true,
            alreadyActive: true
          };

          return;
        }

        usedMs += Math.min(elapsed, MAX_STALE_SESSION_MS);

        tx.set(
          usage,
          {
            dayKey: today,
            usedMs,
            updatedAt: FieldValue.serverTimestamp()
          },
          { merge: true }
        );

        tx.set(
          current,
          {
            active: false,
            endedAtMs: now,
            endedReason: "stale-session-closed",
            updatedAt: FieldValue.serverTimestamp()
          },
          { merge: true }
        );
      }

      const quota = buildQuota(plan, usedMs);

      if (!quota.allowed) {
        result = {
          ...quota,
          day: today,
          active: false
        };

        return;
      }

      tx.set(
        current,
        {
          active: true,
          uid: req.user.uid,
          startedAtMs: now,
          dayKey: today,
          planAtStart: plan,
          updatedAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      );

      result = {
        ...quota,
        day: today,
        active: true,
        alreadyActive: false,
        sessionStartedAtMs: now
      };
    });

    if (!result.allowed) {
      return res.status(403).json({
        success: false,
        error: "Daily voice limit reached.",
        ...result
      });
    }

    return res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error("Voice start error:", error.message);

    return res.status(500).json({
      success: false,
      error: "Could not start the voice session."
    });
  }
});

// End a voice session and save usage
router.post("/end", requireAuth, async (req, res) => {
  if (!requireFirebase(res)) return;

  try {
    const now = Date.now();
    const today = dayKey(new Date(now));
    const { user, usage, current } = getRefs(req.user.uid);

    let result;

    await getDb().runTransaction(async (tx) => {
      const [userSnap, usageSnap, sessionSnap] = await Promise.all([
        tx.get(user),
        tx.get(usage),
        tx.get(current)
      ]);

      const userData = userSnap.data() || {};
      const plan = getActivePlan(userData, now);
      const session = sessionSnap.data() || {};

      let usedMs = Math.max(
        0,
        Number(usageSnap.data()?.usedMs) || 0
      );

      if (!session.active || !Number(session.startedAtMs)) {
        result = {
          ...buildQuota(plan, usedMs),
          day: today,
          active: false,
          ended: false
        };

        return;
      }

      const elapsed = Math.max(
        0,
        Math.min(
          now - Number(session.startedAtMs),
          MAX_STALE_SESSION_MS
        )
      );

      const sessionDay = String(session.dayKey || today);
      const sessionUsage = getRefs(req.user.uid, sessionDay).usage;

      if (sessionDay !== today) {
        const oldUsageSnap = await tx.get(sessionUsage);

        usedMs = Math.max(
          0,
          Number(oldUsageSnap.data()?.usedMs) || 0
        );
      }

      usedMs += elapsed;

      const sessionPlan = String(session.planAtStart || plan);
      const maximum = MAX_MINUTES[sessionPlan] ?? MAX_MINUTES.free;

      if (Number.isFinite(maximum)) {
        usedMs = Math.min(usedMs, maximum * 60_000);
      }

      tx.set(
        sessionUsage,
        {
          dayKey: sessionDay,
          usedMs,
          updatedAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      );

      tx.set(
        current,
        {
          active: false,
          endedAtMs: now,
          durationMs: elapsed,
          updatedAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      );

      result = {
        ...buildQuota(getActivePlan(userData, now), usedMs),
        day: sessionDay,
        active: false,
        ended: true,
        durationMs: elapsed
      };
    });

    return res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error("Voice end error:", error.message);

    return res.status(500).json({
      success: false,
      error: "Could not save voice session usage."
    });
  }
});

export default router;
                 
