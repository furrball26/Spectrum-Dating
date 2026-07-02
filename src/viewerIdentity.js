import { getUserId } from "./api.js";

// The current viewer's identity for the match moment — name/photo from the
// cached profile, id from auth. Best-effort: the monogram avatar degrades
// gracefully on a missing name. (Shared by Discover, Matches, and Messages.)
export function getViewerIdentity() {
  let profile = {};
  try {
    profile = JSON.parse(localStorage.getItem("spectrum_profile") || "{}") || {};
  } catch {
    profile = {};
  }
  return {
    name: profile.displayName || profile.name || "You",
    userId: getUserId() || profile.memberId || profile.userId || null,
    photoUrl: profile.photoUrl || profile.photo_url || null,
  };
}
