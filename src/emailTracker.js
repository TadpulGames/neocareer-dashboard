// emailTracker.js
// Reads lastIndex directly from candidatelist2 (written by talent portal on candidate login).
// Dashboard only reads from candidatelist2 — no separate AdminTracking collection needed.

import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebaseConfig';

const LIST_REF = ['CandidateSourcing', 'candidatelist2'];

/**
 * No-op on dashboard side — snapshots are written by the talent portal Login.js
 * when a candidate logs in. We just read from candidatelist2 directly.
 */
export async function trackEmailSnapshot(_userEmail) {
  // Snapshots are written by talent portal — nothing to do here on admin side.
}

/**
 * Fetch everything the dashboard needs from candidatelist2.
 * lastIndex is stored inside candidatelist2 by the talent portal.
 */
export async function fetchDashboardData(_userEmail) {
  const listSnap = await getDoc(doc(db, ...LIST_REF));

  if (!listSnap.exists()) {
    return { emails: [], updatedAt: null, lastIndex: [] };
  }

  const data = listSnap.data();

  return {
    emails    : data.emails    || [],
    updatedAt : data.updatedAt || null,
    lastIndex : data.lastIndex || [],   // ← written by talent portal Login.js
  };
}