/**
 * cleanup.js — Shared Firebase room cleanup utilities
 *
 * Strategy:
 *  - Empty rooms (presence count = 0) that are older than 2 minutes are deleted.
 *  - The 2-minute grace period protects rooms that were just created before
 *    the admin has had a chance to enter their username and register presence.
 */
import { db } from "../firebase";
import { ref, get, remove } from "firebase/database";

/**
 * Scans all rooms and deletes those with no participants.
 * Call this on app startup (JoinPage / HomePage mount).
 * @returns {Promise<number>} number of rooms deleted
 */
export async function cleanupEmptyRooms() {
  try {
    const snap = await get(ref(db, "rooms"));
    if (!snap.exists()) return 0;

    const rooms = snap.val();
    const now = Date.now();
    const toDelete = [];

    for (const [roomId, room] of Object.entries(rooms)) {
      const presenceCount = room.presence
        ? Object.keys(room.presence).length
        : 0;
      const ageMs = now - (room.createdAt || 0);
      const graceMs = 2 * 60 * 1000; // 2 minutes grace for brand-new rooms

      if (presenceCount === 0 && ageMs > graceMs) {
        toDelete.push(roomId);
      }
    }

    await Promise.all(toDelete.map((id) => remove(ref(db, `rooms/${id}`))));

    if (toDelete.length > 0) {
      console.log(`🧹 Cleaned up ${toDelete.length} empty room(s):`, toDelete);
    }
    return toDelete.length;
  } catch (err) {
    // Non-critical — silently fail so it never blocks the UI
    console.warn("Room cleanup failed (non-critical):", err);
    return 0;
  }
}

/**
 * Deletes a specific room only if its presence node is empty.
 * Call this after manually removing a user's presence entry.
 * @param {string} roomId
 */
export async function deleteRoomIfEmpty(roomId) {
  try {
    const snap = await get(ref(db, `rooms/${roomId}/presence`));
    const isEmpty = !snap.exists() || Object.keys(snap.val()).length === 0;
    if (isEmpty) {
      await remove(ref(db, `rooms/${roomId}`));
      console.log(`🗑️ Room ${roomId} deleted — no participants remaining.`);
      return true;
    }
    return false;
  } catch (err) {
    console.warn("deleteRoomIfEmpty failed:", err);
    return false;
  }
}
