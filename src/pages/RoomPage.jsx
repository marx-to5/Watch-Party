import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import ReactPlayer from "react-player";
import YouTube from "react-youtube";
import {
  Input,
  Button,
  message,
  Typography,
  Tooltip,
  Spin,
  Modal,
  Popover,
} from "antd";
import {
  ThunderboltFilled,
  SendOutlined,
  CopyOutlined,
  LinkOutlined,
  SmileOutlined,
  ArrowLeftOutlined,
  UserOutlined,
  PlayCircleOutlined,
  ShareAltOutlined,
  LockOutlined,
  TeamOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  LoadingOutlined,
  VideoCameraOutlined,
  MessageOutlined,
  SyncOutlined,
  DesktopOutlined,
  LogoutOutlined,
  CrownOutlined,
  HomeOutlined,
  KeyOutlined,
  EnterOutlined,
  CloseOutlined,
  MoreOutlined,
  DeleteOutlined,
} from "@ant-design/icons";
import { db } from "../firebase";
import {
  ref,
  onValue,
  push,
  set,
  remove,
  onDisconnect,
  get,
} from "firebase/database";
import { deleteRoomIfEmpty } from "../utils/cleanup";
import "./RoomPage.css";

const { Text, Title } = Typography;

// ── URL Helpers ────────────────────────────────────────────────────────────────

/**
 * Extract Google Drive file ID from any Drive URL variant:
 *   /file/d/{ID}/view|preview|edit, /open?id={ID}, /uc?id={ID}&...
 */
function extractDriveFileId(url) {
  const fileMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch) return fileMatch[1];
  const idMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idMatch) return idMatch[1];
  return null;
}

/**
 * Extract YouTube ID
 */
function extractYouTubeId(url) {
  if (!url) return null;
  const match = url.match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/);
  return match ? match[1] : null;
}

/** Detect the type of a video URL. */
function detectVideoType(url) {
  if (!url) return null;
  const lowerUrl = url.toLowerCase();
  if (/youtube\.com\/watch|youtu\.be\/|youtube\.com\/embed/.test(lowerUrl)) return "youtube";
  if (/drive\.google\.com/.test(lowerUrl)) return "drive";
  // Direct video types or cloud storage that provides direct streams
  if (/dropbox\.com|pixeldrain\.com|catbox\.moe/.test(lowerUrl)) return "direct";
  // pCloud public links
  if (/pcloud\.(link|host)\/publink/.test(lowerUrl)) return "direct";
  if (/\.(mp4|webm|ogg|mov|mkv|avi|m3u8)(\?.*)?$/i.test(lowerUrl)) return "direct";
  return null;
}

/**
 * Convert URL to ReactPlayer-friendly format.
 * Drive URLs are NOT converted here — they use a separate <iframe> renderer.
 */
function toReactPlayerUrl(url) {
  if (!url) return "";
  let processed = url;

  // Dropbox: auto-replace dl=0 with raw=1 for direct streaming
  if (processed.includes("dropbox.com")) {
    processed = processed.replace(/(\?|&)dl=[01]/, "$1raw=1");
    if (!processed.includes("raw=1")) {
      processed += (processed.includes("?") ? "&" : "?") + "raw=1";
    }
  }

  // PixelDrain: use direct API link
  if (processed.includes("pixeldrain.com/u/")) {
    processed = processed.replace("pixeldrain.com/u/", "pixeldrain.com/api/file/");
  }

  const type = detectVideoType(processed);
  if (type === "youtube") {
    const match = processed.match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/);
    return match ? `https://www.youtube.com/watch?v=${match[1]}` : processed;
  }
  return processed;
}



/**
 * Normalise URL before writing to Firebase.
 * Drive → /preview format (safe, works for any sharing setting).
 * YouTube → standard watch URL.
 */
function convertUrlForStore(url) {
  if (!url) return "";
  let processed = url;

  // Cleanup Dropbox links before storing
  if (processed.includes("dropbox.com")) {
    processed = processed.replace(/(\?|&)dl=[01]/, "$1raw=1");
    if (!processed.includes("raw=1")) {
      processed += (processed.includes("?") ? "&" : "?") + "raw=1";
    }
  }

  // Cleanup PixelDrain links before storing
  if (processed.includes("pixeldrain.com/u/")) {
    processed = processed.replace("pixeldrain.com/u/", "pixeldrain.com/api/file/");
  }

  const type = detectVideoType(processed);
  if (type === "youtube") {
    const match = processed.match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/);
    return match ? `https://www.youtube.com/watch?v=${match[1]}` : processed;
  }
  if (type === "drive") {
    const id = extractDriveFileId(processed);
    return id ? `https://drive.google.com/file/d/${id}/preview` : processed;
  }
  return processed;
}

function formatTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatSeconds(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function validateVideoUrl(url) {
  return new Promise((resolve) => {
    setTimeout(() => {
      const type = detectVideoType(url);
      resolve(type ? { valid: true, type } : { valid: false, type: null });
    }, 700);
  });
}

export default function RoomPage() {
  const { roomId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const isAdmin = searchParams.get("admin") === "true";

  // ── Room state ─────────────────────────────────────────────────────────────
  const [roomData, setRoomData] = useState(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [messages, setMessages] = useState([]);
  const [participantCount, setParticipantCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [roomExists, setRoomExists] = useState(true);

  // ── Username ───────────────────────────────────────────────────────────────
  const [username, setUsername] = useState("");
  const [usernameSet, setUsernameSet] = useState(false);
  const [usernameInput, setUsernameInput] = useState("");

  // ── Chat ───────────────────────────────────────────────────────────────────
  const [chatInput, setChatInput] = useState("");
  const chatEndRef = useRef(null);
  const [typingUsers, setTypingUsers] = useState([]);
  const typingTimeoutRef = useRef(null);
  const [replyTo, setReplyTo] = useState(null); // { id, user, text }
  const [activeMessageId, setActiveMessageId] = useState(null);

  // ── Admin video control ────────────────────────────────────────────────────
  const [videoInput, setVideoInput] = useState("");
  const [adminVideoStatus, setAdminVideoStatus] = useState("idle");
  const debounceRef = useRef(null);
  const presenceRef = useRef(null);

  // ── Video sync state ───────────────────────────────────────────────────────
  const [isPlaying, setIsPlaying] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState("idle"); // idle | syncing | synced
  const [driveError, setDriveError] = useState(false);   // Drive 10s timeout
  const [driveLoading, setDriveLoading] = useState(false); // Drive iframe loading
  const [guestInteracted, setGuestInteracted] = useState(false); // For breaking autoplay restrictions
  const playerRef = useRef(null);
  // Flag: true when we're applying a Firebase update → prevents push-back loop
  const isSyncingRef = useRef(false);
  const syncTimeoutRef = useRef(null);
  const driveTimeoutRef = useRef(null);
  // Tracks last reported progress for seek detection (YouTube doesn't fire onSeek)
  const lastProgressRef = useRef({ time: 0, wallTime: Date.now(), playing: false });
  // Tracks the true synced state to snap guests back if they deviate
  const syncStateRef = useRef({ isPlaying: false, currentTime: 0, lastUpdated: Date.now() });

  // ── Modals ─────────────────────────────────────────────────────────────────
  const [shareModalOpen, setShareModalOpen] = useState(false);

  // ── Participants panel ────────────────────────────────────────────────────
  const [participantsPanelOpen, setParticipantsPanelOpen] = useState(false);
  const [participants, setParticipants] = useState([]);
  const [isMuted, setIsMuted] = useState(false);     // this user is muted by admin
  const [mutedKeys, setMutedKeys] = useState(new Set()); // admin view: which keys are muted

  // Derived ────────────────────────────────────────────────────────────────
  const playerType = detectVideoType(videoUrl);
  const isDriveUrl = playerType === "drive";
  const youtubeId = useMemo(() => extractYouTubeId(videoUrl), [videoUrl]);

  // Drive: build /preview iframe URL (reliable, Google's own embedded player)
  const drivePreviewUrl = useMemo(() => {
    if (!isDriveUrl || !videoUrl) return "";
    const id = extractDriveFileId(videoUrl);
    return id ? `https://drive.google.com/file/d/${id}/preview` : videoUrl;
  }, [isDriveUrl, videoUrl]);

  const [reactPlayerUrl, setReactPlayerUrl] = useState("");

  useEffect(() => {
    let active = true;
    const processUrl = async () => {
      if (!videoUrl) {
        if (active) setReactPlayerUrl("");
        return;
      }
      
      let processed = toReactPlayerUrl(videoUrl);
      
      // Auto-resolve pCloud publinks to direct streaming URLs via API
      if (processed.includes("pcloud.link/publink") || processed.includes("pcloud.host/publink")) {
        const match = processed.match(/code=([A-Za-z0-9_-]+)/);
        if (match) {
          try {
            const res = await fetch(`https://api.pcloud.com/getpublinkdownload?code=${match[1]}`);
            const data = await res.json();
            if (data.result === 0 && data.hosts && data.path) {
              processed = `https://${data.hosts[0]}${data.path}`;
            }
          } catch (e) {
            console.error("pCloud resolve error:", e);
          }
        }
      }
      
      if (active) setReactPlayerUrl(processed);
    };
    processUrl();
    return () => { active = false; };
  }, [videoUrl]);

  // ── Firebase: Room data ────────────────────────────────────────────────────
  useEffect(() => {
    const roomRef = ref(db, `rooms/${roomId}`);
    const unsub = onValue(
      roomRef,
      (snap) => {
        if (!snap.exists()) { setRoomExists(false); setLoading(false); return; }
        const data = snap.val();
        setRoomData(data);
        setVideoUrl(data.videoUrl || "");
        setLoading(false);
      },
      (err) => { console.error(err); setRoomExists(false); setLoading(false); }
    );
    return () => unsub();
  }, [roomId]);

  // ── Firebase: Messages ─────────────────────────────────────────────────────
  useEffect(() => {
    const msgsRef = ref(db, `rooms/${roomId}/messages`);
    const unsub = onValue(msgsRef, (snap) => {
      const data = snap.val();
      if (data) {
        const arr = Object.entries(data).map(([id, msg]) => ({ id, ...msg }));
        // Firebase push IDs are chronologically sorted.
        // This avoids issues where client clocks are out of sync.
        arr.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        setMessages(arr);
      } else {
        setMessages([]);
      }
    });
    return () => unsub();
  }, [roomId]);

  // ── Firebase: Presence count + full list + kick detection ─────────────────
  useEffect(() => {
    if (!usernameSet) return; // wait until we have a presence key
    const presRef = ref(db, `rooms/${roomId}/presence`);
    const unsub = onValue(presRef, (snap) => {
      const data = snap.val();
      const count = data ? Object.keys(data).length : 0;
      setParticipantCount(count);

      // Build participants list for the panel
      if (data) {
        const list = Object.entries(data).map(([key, val]) => ({ key, ...val }));
        list.sort((a, b) => a.joinedAt - b.joinedAt);
        setParticipants(list);
      } else {
        setParticipants([]);
      }

      // ― Kick detection ―――――――――――――――――――――――――――――――――――――――――
      // If our own presence key no longer exists in the data, we were kicked
      if (presenceRef.current && data) {
        const myKey = presenceRef.current.key;
        if (!data[myKey] && count > 0) {
          presenceRef.current = null; // prevent cleanup loop
          message.warning({ content: "You have been removed from the room.", duration: 4 });
          navigate("/");
          return;
        }
      }

      // Auto-delete: if all participants dropped, room is empty — clean up & leave
      if (count === 0 && usernameSet) {
        remove(ref(db, `rooms/${roomId}`)).catch(console.error);
        message.info({ content: "The room is now empty and has been closed.", duration: 3 });
        navigate("/");
      }
    });
    return () => unsub();
  }, [roomId, usernameSet, navigate]);

  // ── Firebase: Mute listener (guest → lock own input) ────────────────
  useEffect(() => {
    if (!usernameSet || !presenceRef.current) return;
    const myKey = presenceRef.current.key;
    const mutedRef = ref(db, `rooms/${roomId}/muted/${myKey}`);
    const unsub = onValue(mutedRef, (snap) => {
      setIsMuted(snap.exists());
    });
    return () => unsub();
  }, [roomId, usernameSet]);

  // ── Firebase: Muted keys listener (admin → show toggle state) ────────
  useEffect(() => {
    if (!isAdmin || !usernameSet) return;
    const allMutedRef = ref(db, `rooms/${roomId}/muted`);
    const unsub = onValue(allMutedRef, (snap) => {
      const data = snap.val();
      setMutedKeys(data ? new Set(Object.keys(data)) : new Set());
    });
    return () => unsub();
  }, [roomId, isAdmin, usernameSet]);

  // ── Firebase: Typing indicator listener ────────────────────────────────────
  useEffect(() => {
    if (!usernameSet) return;
    const typingRef = ref(db, `rooms/${roomId}/typing`);
    const unsub = onValue(typingRef, (snap) => {
      if (snap.exists()) {
        const data = snap.val();
        // Get all typing usernames that are NOT the current user
        const users = Object.values(data).filter(name => name !== username);
        setTypingUsers(users);
      } else {
        setTypingUsers([]);
      }
    });
    return () => unsub();
  }, [roomId, username, usernameSet]);

  // ── Firebase: Video status sync ────────────────────────────────────────────
  useEffect(() => {
    if (!usernameSet) return;
    const vsRef = ref(db, `rooms/${roomId}/videoStatus`);
    const unsub = onValue(vsRef, (snap) => {
      const vs = snap.val();
      if (!vs) return;

      // Block outgoing events while we apply incoming Firebase state
      isSyncingRef.current = true;
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
      setSyncStatus("syncing");

      syncStateRef.current = {
        isPlaying: vs.isPlaying ?? false,
        currentTime: vs.currentTime ?? 0,
        lastUpdated: vs.lastUpdated ?? Date.now()
      };

      // 1. Sync play/pause
      setIsPlaying(vs.isPlaying ?? false);

      // 2. Sync current time if significantly out of sync
      if (playerRef.current && vs.currentTime !== undefined) {
        let localTime = 0;
        try {
          localTime = playerType === "youtube"
            ? playerRef.current.getCurrentTime()
            : (playerRef.current.currentTime || 0);
        } catch (e) {
          console.warn("Could not get local time:", e);
        }

        // Compensate for network latency: add elapsed time since the event was pushed
        const elapsed = vs.lastUpdated
          ? Math.max(0, (Date.now() - vs.lastUpdated) / 1000)
          : 0;
        const targetTime = vs.isPlaying
          ? vs.currentTime + elapsed
          : vs.currentTime;

        if (Math.abs(localTime - targetTime) > 2) {
          try {
            if (playerType === "youtube") {
              playerRef.current.seekTo(targetTime, true);
            } else if (playerRef.current instanceof HTMLVideoElement) {
              playerRef.current.currentTime = targetTime;
            } else if (playerRef.current.seekTo) {
              playerRef.current.seekTo(targetTime, "seconds");
            }
          } catch (e) {
            console.warn("Seek sync error:", e);
          }
        }
      }

      // 3. Force playback sync
      if (playerRef.current) {
        try {
          if (playerType === "youtube") {
            if (vs.isPlaying) playerRef.current.playVideo();
            else playerRef.current.pauseVideo();
          } else if (playerRef.current instanceof HTMLVideoElement) {
            if (vs.isPlaying) playerRef.current.play().catch(() => { });
            else playerRef.current.pause();
          }
        } catch (e) {
          console.warn("Playback sync error:", e);
        }
      }

      // Clear flag after player has time to settle (600ms)
      syncTimeoutRef.current = setTimeout(() => {
        isSyncingRef.current = false;
        setSyncStatus("synced");
        setTimeout(() => setSyncStatus("idle"), 1800);
      }, 600);
    });

    return () => {
      unsub();
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    };
  }, [roomId, usernameSet]);

  // ── Push video status to Firebase ─────────────────────────────────────────
  const pushVideoStatus = useCallback(
    (playing, time) => {
      set(ref(db, `rooms/${roomId}/videoStatus`), {
        isPlaying: playing,
        currentTime: Math.max(0, time),
        lastUpdated: Date.now(),
      }).catch(console.error);
    },
    [roomId]
  );

  const enforceGuestSync = useCallback(() => {
    if (isAdmin) return;
    const { isPlaying: expectedPlaying, currentTime, lastUpdated } = syncStateRef.current;

    // Calculate expected time
    const elapsed = lastUpdated ? Math.max(0, (Date.now() - lastUpdated) / 1000) : 0;
    const targetTime = expectedPlaying ? currentTime + elapsed : currentTime;

    if (playerRef.current) {
      const localTime = playerType === "youtube"
        ? playerRef.current.getCurrentTime()
        : (playerRef.current.currentTime || 0);

      if (Math.abs(localTime - targetTime) > 2) {
        if (playerType === "youtube") {
          playerRef.current.seekTo(targetTime, true);
        } else if (playerRef.current instanceof HTMLVideoElement) {
          playerRef.current.currentTime = targetTime;
        } else {
          playerRef.current.seekTo?.(targetTime, "seconds");
        }
      }

      if (playerType === "youtube") {
        if (expectedPlaying) playerRef.current.playVideo();
        else playerRef.current.pauseVideo();
      } else if (playerRef.current instanceof HTMLVideoElement) {
        if (expectedPlaying) playerRef.current.play().catch(() => { });
        else playerRef.current.pause();
      } else {
        const internalPlayer = playerRef.current.getInternalPlayer?.();
        if (expectedPlaying) {
          internalPlayer?.playVideo?.() || internalPlayer?.play?.();
        } else {
          internalPlayer?.pauseVideo?.() || internalPlayer?.pause?.();
        }
      }
    }
  }, [isAdmin, playerType]);

  // ── ReactPlayer event handlers ─────────────────────────────────────────────
  // Each handler checks isSyncingRef to prevent the feedback loop:
  // Firebase update → setIsPlaying(true) → player fires onPlay → pushVideoStatus → loop ✗
  // Firebase update → isSyncingRef=true → setIsPlaying(true) → player fires onPlay → guard exits ✓

  const handlePlay = useCallback(() => {
    if (!isAdmin) {
      if (!isSyncingRef.current) enforceGuestSync();
      return;
    }
    if (isSyncingRef.current) return;
    const time = playerType === "youtube"
      ? playerRef.current?.getCurrentTime()
      : (playerRef.current?.currentTime || 0);
    pushVideoStatus(true, time);
    lastProgressRef.current = { time, wallTime: Date.now(), playing: true };
  }, [pushVideoStatus, isAdmin, enforceGuestSync, playerType]);

  const handlePause = useCallback(() => {
    if (!isAdmin) {
      if (!isSyncingRef.current) enforceGuestSync();
      return;
    }
    if (isSyncingRef.current) return;
    const time = playerType === "youtube"
      ? playerRef.current?.getCurrentTime()
      : (playerRef.current?.currentTime || 0);
    pushVideoStatus(false, time);
    lastProgressRef.current = { time, wallTime: Date.now(), playing: false };
  }, [pushVideoStatus, isAdmin, enforceGuestSync, playerType]);

  const togglePiP = async () => {
    if (!playerRef.current || playerType !== "direct") return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (playerRef.current.requestPictureInPicture) {
        await playerRef.current.requestPictureInPicture();
      }
    } catch (error) {
      console.warn("PiP error:", error);
    }
  };

  // onSeek fires for HTML5 video; for YouTube we rely on onProgress seek detection
  const handleSeek = useCallback(
    (seconds) => {
      if (!isAdmin) {
        if (!isSyncingRef.current) enforceGuestSync();
        return;
      }
      if (isSyncingRef.current) return;
      pushVideoStatus(isPlaying, seconds);
      lastProgressRef.current = { time: seconds, wallTime: Date.now(), playing: isPlaying };
    },
    [pushVideoStatus, isPlaying, isAdmin, enforceGuestSync]
  );

  // Detect seeks on YouTube by spotting large jumps in progress
  const handleProgress = useCallback(
    ({ playedSeconds }) => {
      if (!isAdmin) {
        if (!isSyncingRef.current) enforceGuestSync();
        return;
      }
      if (isSyncingRef.current) return;
      const now = Date.now();
      const { time, wallTime, playing } = lastProgressRef.current;
      const elapsed = (now - wallTime) / 1000;

      if (playing && elapsed > 0.8) {
        const expected = time + elapsed;
        // If actual time diverges > 3s from expected, the user seeked
        if (Math.abs(playedSeconds - expected) > 3) {
          pushVideoStatus(isPlaying, playedSeconds);
        }
      }
      lastProgressRef.current = { time: playedSeconds, wallTime: now, playing: isPlaying };
    },
    [pushVideoStatus, isPlaying, isAdmin]
  );

  // On player ready: do an initial sync to catch up if room was already playing
  const handleReady = useCallback(async () => {
    setVideoReady(true);
    try {
      const snap = await get(ref(db, `rooms/${roomId}/videoStatus`));
      const vs = snap.val();
      if (vs && playerRef.current) {
        isSyncingRef.current = true;
        const elapsed = vs.lastUpdated
          ? Math.max(0, (Date.now() - vs.lastUpdated) / 1000)
          : 0;
        const target = vs.isPlaying ? vs.currentTime + elapsed : vs.currentTime;
        playerRef.current.seekTo(Math.max(0, target), "seconds");
        setIsPlaying(vs.isPlaying ?? false);
        setTimeout(() => { isSyncingRef.current = false; }, 800);
      }
    } catch (e) { console.error(e); }
  }, [roomId]);

  // ── Drive iframe helpers ───────────────────────────────────────────────────
  const startDriveTimeout = useCallback(() => {
    setDriveError(false);
    setDriveLoading(true);
    if (driveTimeoutRef.current) clearTimeout(driveTimeoutRef.current);
    driveTimeoutRef.current = setTimeout(() => {
      setDriveError(true);
      setDriveLoading(false);
    }, 10000);
  }, []);

  // Called when the iframe fires onLoad successfully
  const handleDriveLoad = useCallback(() => {
    if (driveTimeoutRef.current) clearTimeout(driveTimeoutRef.current);
    setDriveLoading(false);
    setDriveError(false);
    setVideoReady(true);
  }, []);

  // Manual sync: participants click this to reload iframe at admin's timestamp
  const handleManualSync = useCallback(async () => {
    try {
      const snap = await get(ref(db, `rooms/${roomId}/videoStatus`));
      const vs = snap.val();
      if (vs) {
        setSyncStatus("syncing");
        // For Drive iframes we can't programmatically seek — reload the iframe
        // with a cache-busting param so it at least starts fresh.
        setDriveLoading(true);
        setDriveError(false);
        setVideoReady(false);
        // Trigger re-mount of the iframe by toggling a key
        setDriveSyncKey((k) => k + 1);
        startDriveTimeout();
        message.success("Syncing with admin…");
        setTimeout(() => { setSyncStatus("synced"); setTimeout(() => setSyncStatus("idle"), 1800); }, 1500);
      }
    } catch (e) {
      message.error("Sync failed, please try again.");
    }
  }, [roomId, startDriveTimeout]);

  // Key used to force-remount the Drive iframe
  const [driveSyncKey, setDriveSyncKey] = useState(0);

  // ── Auto-scroll chat ───────────────────────────────────────────────────────
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Leave room: remove presence & delete room if now empty ────────────────
  const leaveRoom = useCallback(async () => {
    if (presenceRef.current) {
      try {
        await remove(presenceRef.current);
        presenceRef.current = null;
        await deleteRoomIfEmpty(roomId);
      } catch (e) {
        console.warn("Leave room cleanup error:", e);
      }
    }
    navigate("/");
  }, [roomId, navigate]);

  // Cleanup on component unmount (e.g., React hot reload, route change)
  useEffect(() => {
    return () => {
      if (presenceRef.current) {
        remove(presenceRef.current).catch(() => { });
        // Note: deleteRoomIfEmpty not called here because unmount can race
        // with onDisconnect; the cleanup utility on next page load handles it.
      }
    };
  }, []);

  // ── Username gate ──────────────────────────────────────────────────────────
  const registerPresence = useCallback(async (name) => {
    if (!name || !roomId) return;
    const pRef = ref(db, `rooms/${roomId}/presence/${name}_${Date.now()}`);
    presenceRef.current = pRef;
    // Store isAdmin so ALL viewers (including guests) can see the host crown
    await set(pRef, { name, joinedAt: Date.now(), isAdmin: isAdmin || false });
    onDisconnect(pRef).remove(); // Auto-removed by Firebase on tab close / disconnect
  }, [roomId, isAdmin]);

  const handleSetUsername = async () => {
    const name = usernameInput.trim();
    if (!name) return message.warning("Please enter your name");
    if (roomData) {
      const presSnap = await get(ref(db, `rooms/${roomId}/presence`));
      const current = presSnap.exists() ? Object.keys(presSnap.val()).length : 0;
      const max = roomData.capacity || 20;
      if (current >= max) {
        message.error({ content: `🚫 Room is full! (${current}/${max})`, duration: 4 });
        return;
      }
    }
    setUsername(name);
    setUsernameSet(true);
    await registerPresence(name);
  };

  // ── Admin: video URL validation ────────────────────────────────────────────
  const handleVideoInput = useCallback((e) => {
    const val = e.target.value;
    setVideoInput(val);
    setAdminVideoStatus("idle");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!val.trim()) return;
    setAdminVideoStatus("checking");
    debounceRef.current = setTimeout(async () => {
      const result = await validateVideoUrl(val.trim());
      setAdminVideoStatus(result.valid ? "valid" : "invalid");
    }, 600);
  }, []);

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  // Start Drive timeout whenever a new Drive URL is set
  useEffect(() => {
    if (isDriveUrl && videoUrl) {
      setDriveSyncKey(0);
      startDriveTimeout();
    } else {
      // Reset Drive state if URL changes to a non-Drive type
      setDriveError(false);
      setDriveLoading(false);
      if (driveTimeoutRef.current) clearTimeout(driveTimeoutRef.current);
    }
    // Clean up on unmount
    return () => { if (driveTimeoutRef.current) clearTimeout(driveTimeoutRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUrl]);

  // ── Admin: set new video & reset sync state for everyone ──────────────────
  const handleSetVideo = async () => {
    if (!videoInput.trim()) return message.warning("Please paste a video URL");
    const converted = convertUrlForStore(videoInput.trim());
    try {
      await set(ref(db, `rooms/${roomId}/videoUrl`), converted);
      // Reset sync state — everyone's player starts fresh
      await set(ref(db, `rooms/${roomId}/videoStatus`), {
        isPlaying: false,
        currentTime: 0,
        lastUpdated: Date.now(),
      });
      setIsPlaying(false);
      setVideoReady(false);
      setVideoInput("");
      setAdminVideoStatus("idle");
      message.success("Video updated for everyone! 🎬");
    } catch {
      message.error("Failed to update video URL");
    }
  };

  // ── Chat send ──────────────────────────────────────────────────────────────
  const handleChatInputChange = (e) => {
    setChatInput(e.target.value);
    if (!usernameSet || !presenceRef.current || !chatEnabled || isMuted) return;
    
    // Set user as typing
    const typingRef = ref(db, `rooms/${roomId}/typing/${presenceRef.current.key}`);
    set(typingRef, username).catch(() => {});
    
    // Debounce to remove typing status after 2 seconds of inactivity
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      remove(typingRef).catch(() => {});
    }, 2000);
  };

  const handleSendMessage = async () => {
    const text = chatInput.trim();
    if (!text) return;
    setChatInput("");
    const currentReplyTo = replyTo;
    setReplyTo(null);
    try {
      const msgData = {
        user: username,
        text,
        timestamp: Date.now(),
      };
      if (currentReplyTo) {
        msgData.replyTo = {
          id: currentReplyTo.id,
          user: currentReplyTo.user,
          text: currentReplyTo.text,
        };
      }
      await push(ref(db, `rooms/${roomId}/messages`), msgData);
      // Clear typing status immediately upon sending
      if (presenceRef.current) {
        remove(ref(db, `rooms/${roomId}/typing/${presenceRef.current.key}`)).catch(() => {});
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      }
    } catch { message.error("Failed to send message"); }
  };

  const handleCopyRoomId = () => { navigator.clipboard.writeText(roomId); message.success("Room ID copied!"); };
  const handleCopyLink = () => { navigator.clipboard.writeText(window.location.href.split("?")[0]); message.success("Link copied!"); };

  // ── Reactions ──────────────────────────────────────────────────────────────
  const handleReaction = useCallback(async (msgId, emoji) => {
    if (!usernameSet || !roomId || !msgId) return;
    try {
      const rxRef = ref(db, `rooms/${roomId}/messages/${msgId}/reactions/${username}`);
      await set(rxRef, emoji);
    } catch { message.error("Failed to add reaction"); }
  }, [roomId, usernameSet, username]);

  const REACTION_EMOJIS = ["❤️", "😂", "🥲", "😁", "😡", "👍"];

  const handleDeleteMessage = async (msgId) => {
    try {
      await remove(ref(db, `rooms/${roomId}/messages/${msgId}`));
      message.success("Message deleted");
    } catch {
      message.error("Failed to delete message");
    }
  };

  const getMessageOptionsContent = (msg, isOwn) => {
    const canDelete = isOwn || isAdmin;
    
    return (
    <div className="chat-options-menu">
      {!isOwn && (
        <>
          <div className="reaction-picker-container">
            {REACTION_EMOJIS.map(em => (
              <span 
                key={em} 
                onClick={() => {
                  handleReaction(msg.id, em);
                  setActiveMessageId(null);
                }}
                className="reaction-emoji-btn"
              >
                {em}
              </span>
            ))}
          </div>
          <div className="chat-options-divider" />
        </>
      )}
      <div 
        className="chat-options-action"
        onClick={() => {
          setReplyTo({ id: msg.id, user: msg.user, text: msg.text });
          setActiveMessageId(null);
        }}
      >
        <EnterOutlined style={{ transform: "scaleX(-1)", marginRight: 8 }} />
        <span>Reply</span>
      </div>

      {canDelete && (
        <>
          <div className="chat-options-divider" />
          <div 
            className="chat-options-action chat-options-action-danger"
            onClick={() => {
              handleDeleteMessage(msg.id);
              setActiveMessageId(null);
            }}
          >
            <DeleteOutlined style={{ marginRight: 8 }} />
            <span>Delete</span>
          </div>
        </>
      )}
    </div>
  );
};

  // ── Admin: kick a participant (remove their presence entry) ───────────
  const handleKickParticipant = useCallback(async (participantKey, participantName) => {
    if (!isAdmin) return;
    try {
      await remove(ref(db, `rooms/${roomId}/presence/${participantKey}`));
      // Write a system message to inform the room
      await push(ref(db, `rooms/${roomId}/messages`), {
        user: "🔴 System",
        text: `${participantName} has been removed from the room by the host.`,
        timestamp: Date.now(),
        isSystem: true,
      });
      message.success(`${participantName} has been removed.`);
    } catch {
      message.error("Failed to kick participant.");
    }
  }, [isAdmin, roomId]);

  // ── Admin: mute a participant (disable chat for their key) ────────────
  const handleMuteParticipant = useCallback(async (participantKey, participantName) => {
    if (!isAdmin) return;
    try {
      const muteRef = ref(db, `rooms/${roomId}/muted/${participantKey}`);
      const snap = await get(muteRef);
      if (snap.exists()) {
        await remove(muteRef);
        await push(ref(db, `rooms/${roomId}/messages`), {
          user: "🔊 System",
          text: `${participantName} has been unmuted by the host.`,
          timestamp: Date.now(),
          isSystem: true,
        });
        message.success(`${participantName} has been unmuted.`);
      } else {
        await set(muteRef, { name: participantName, mutedAt: Date.now() });
        await push(ref(db, `rooms/${roomId}/messages`), {
          user: "🔇 System",
          text: `${participantName} has been muted by the host.`,
          timestamp: Date.now(),
          isSystem: true,
        });
        message.success(`${participantName} has been muted.`);
      }
    } catch {
      message.error("Failed to mute participant.");
    }
  }, [isAdmin, roomId]);

  const AdminVideoStatusIcon = () => {
    if (adminVideoStatus === "checking") return <LoadingOutlined className="video-status-icon checking" spin />;
    if (adminVideoStatus === "valid") return <CheckCircleFilled className="video-status-icon valid" />;
    if (adminVideoStatus === "invalid") return <CloseCircleFilled className="video-status-icon invalid" />;
    return null;
  };

  // ─── Loading & error states ────────────────────────────────────────────────
  if (loading) return (
    <div className="room-loading">
      <Spin size="large" />
      <Text style={{ color: "#94a3b8", marginTop: 16 }}>Connecting to room…</Text>
    </div>
  );

  if (!roomExists) return (
    <div className="room-loading">
      <CloseCircleFilled style={{ fontSize: 40, color: "#ef4444" }} />
      <Text style={{ color: "#ef4444", fontSize: 18, marginTop: 12 }}>Room not found.</Text>
      <Button onClick={() => navigate("/")} style={{ marginTop: 16 }}>Go Home</Button>
    </div>
  );

  // Username gate
  if (!usernameSet) {
    const capacity = roomData?.capacity || 20;
    return (
      <div className="username-gate">
        <div className="username-gate-bg">
          <div className="orb orb-1" /><div className="orb orb-2" />
        </div>
        <div className="username-card fade-in-up">
          <div className="username-icon"><UserOutlined /></div>
          <Title level={3} style={{ color: "#e2e8f0", margin: "0 0 4px" }}>Enter Your Name</Title>
          {roomData?.name && (
            <Text style={{ color: "#60a5fa", display: "block", fontWeight: 700, fontSize: 15, marginBottom: 4 }}>
              {roomData.name}
            </Text>
          )}
          <Text style={{ color: "#64748b", display: "block", marginBottom: 4 }}>
            Room: <span style={{ color: "#3b82f6", fontWeight: 700, letterSpacing: "0.1em" }}>{roomId}</span>
          </Text>
          <Text style={{ color: "#334155", fontSize: 12, display: "block", marginBottom: 20 }}>
            Capacity: {participantCount}/{capacity} participants
          </Text>
          <Input id="username-input" placeholder="Your display name" value={usernameInput}
            onChange={(e) => setUsernameInput(e.target.value)} onPressEnter={handleSetUsername}
            size="large" style={{ marginBottom: 14, textAlign: "center" }}
          />
          <Button id="set-username-btn" type="primary" size="large" block onClick={handleSetUsername}
            style={{ height: 46, background: "linear-gradient(135deg, #2563eb, #7c3aed)", border: "none" }}>
            Enter Room
          </Button>
          <Button type="text" size="small" icon={<ArrowLeftOutlined />} onClick={() => navigate("/")}
            style={{ color: "#64748b", marginTop: 12 }}>
            Back to Home
          </Button>
        </div>
      </div>
    );
  }

  const capacity = roomData?.capacity || 20;
  const chatEnabled = roomData?.chatEnabled !== false;
  const roomName = roomData?.name || `Room ${roomId}`;
  const isFull = participantCount >= capacity;

  // ─── Main Room UI ──────────────────────────────────────────────────────────
  return (
    <div className="room-page">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="room-header">
        <div className="room-header-left">
          <Button type="text" icon={<ArrowLeftOutlined />} onClick={leaveRoom} className="back-btn" />
          <div className="room-header-brand">
            <PlayCircleOutlined style={{ color: "#3b82f6", fontSize: 20 }} />
            <span className="room-header-title">WatchParty</span>
          </div>
        </div>

        <div className="room-header-center">
          {/* Room name badge */}
          <div className="room-name-badge">
            <HomeOutlined className="badge-icon-desktop" style={{ color: "#64748b", fontSize: 11 }} />
            {isAdmin && <LockOutlined style={{ color: "#facc15", fontSize: 10 }} />}
            <span className="room-name-text">{roomName}</span>
          </div>
          {/* Room code badge */}
          <div className="room-code-badge">
            <KeyOutlined className="badge-icon-desktop" style={{ color: "#60a5fa", fontSize: 11 }} />
            <span className="room-code-text">{roomId}</span>
          </div>
        </div>

        <div className="room-header-right">
          {/* Live sync status pill */}
          {syncStatus === "synced" && (
            <div className="sync-pill synced"><CheckCircleFilled /> Synced</div>
          )}

          {/* Picture-in-Picture Button (Direct links only) */}
          {playerType === "direct" && (
            <Tooltip title="Picture-in-Picture">
              <Button
                icon={<DesktopOutlined />}
                onClick={togglePiP}
                className="header-action-btn"
                style={{ borderRadius: '50%', width: 34, height: 34, padding: 0 }}
              />
            </Tooltip>
          )}

          <div
            id="participants-btn"
            className={`participant-counter participant-counter-btn ${isFull ? "counter-full" : ""}`}
            onClick={() => setParticipantsPanelOpen((v) => !v)}
            title="View participants"
          >
            <TeamOutlined /><span>{participantCount}/{capacity}</span>
          </div>
          <Tooltip title="Share Room">
            <Button id="share-btn" icon={<ShareAltOutlined />} onClick={() => setShareModalOpen(true)} className="header-action-btn" />
          </Tooltip>
        </div>
      </header>

      {/* ── Main Layout ─────────────────────────────────────────────────── */}
      <div className="room-layout">
        {/* ── Video Panel ─────────────────────────────────────────────── */}
        <div className="video-panel">
          {/* Admin control bar */}
          {isAdmin && (
            <div className="video-control-bar">
              <div className="video-control-label">
                <VideoCameraOutlined style={{ color: "#3b82f6" }} />
                <span>Update Video</span>
                <span className="supported-badge">YouTube · Google Drive · MP4</span>
              </div>
              <div className="video-control-input">
                <Input
                  id="video-url-input"
                  placeholder="Paste YouTube, Google Drive, or direct video link…"
                  value={videoInput}
                  onChange={handleVideoInput}
                  style={{ flex: 1 }}
                  suffix={<AdminVideoStatusIcon />}
                  className={`admin-video-input ${adminVideoStatus === "valid" ? "admin-valid" : adminVideoStatus === "invalid" ? "admin-invalid" : ""}`}
                />
                <Button
                  id="set-video-btn"
                  type="primary"
                  icon={<PlayCircleOutlined />}
                  onClick={handleSetVideo}
                  disabled={adminVideoStatus !== "valid"}
                  style={{ background: "linear-gradient(135deg, #2563eb, #7c3aed)", border: "none", flexShrink: 0 }}
                >
                  Play
                </Button>
              </div>
            </div>
          )}

          {/* Video player area */}
          <div className="video-wrapper">
            {/* Minimal Typing overlay indicator inside video */}
            {typingUsers.length > 0 && (
              <div style={{
                position: 'absolute', top: 16, right: 16,
                background: 'rgba(15, 23, 42, 0.4)',
                backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
                padding: '6px 12px', borderRadius: 20,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                zIndex: 50, border: '1px solid rgba(255, 255, 255, 0.05)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.15)', pointerEvents: 'none'
              }}>
                <div className="typing-dots-anim">
                  <span></span><span></span><span></span>
                </div>
              </div>
            )}
            {!videoUrl ? (
              <div className="video-placeholder">
                <PlayCircleOutlined className="video-placeholder-icon" />
                <Text className="video-placeholder-text">
                  {isAdmin ? "Paste a video link above to start watching" : "Waiting for the host to start the video…"}
                </Text>
              </div>

            ) : isDriveUrl ? (
              /* ── Google Drive: embed as /preview iframe ── */
              <div className="react-player-wrapper" style={{ position: "relative" }}>
                {/* Drive error overlay (10s timeout) */}
                {driveError ? (
                  <div className="player-loading-overlay drive-error-overlay">
                    <CloseCircleFilled style={{ fontSize: 36, color: "#ef4444", marginBottom: 12 }} />
                    <Text style={{ color: "#ef4444", fontSize: 15, fontWeight: 600, textAlign: "center" }}>
                      Google Drive is taking too long.<br />
                      Please ensure the file is <strong>"Anyone with the link"</strong> and try refreshing.
                    </Text>
                    <Button
                      type="primary"
                      style={{ marginTop: 16, background: "#2563eb", border: "none" }}
                      onClick={() => { setDriveError(false); setDriveSyncKey((k) => k + 1); startDriveTimeout(); }}
                    >
                      Retry
                    </Button>
                  </div>
                ) : (
                  <iframe
                    key={driveSyncKey}
                    src={drivePreviewUrl}
                    title="Google Drive Video"
                    width="100%"
                    height="100%"
                    allow="autoplay"
                    allowFullScreen
                    frameBorder="0"
                    onLoad={handleDriveLoad}
                    style={{ display: "block", border: "none", borderRadius: 8 }}
                  />
                )}

                {/* Drive loading spinner (shown until iframe fires onLoad or timeout) */}
                {driveLoading && !driveError && (
                  <div className="player-loading-overlay">
                    <Spin size="large" />
                    <Text style={{ color: "#475569", marginTop: 12 }}>Loading Google Drive video…</Text>
                  </div>
                )}

                {/* Guest Join Overlay for Google Drive */}
                {!isAdmin && !guestInteracted && !driveLoading && !driveError && (
                  <div
                    className="player-loading-overlay guest-join-overlay"
                    style={{ background: 'rgba(15, 23, 42, 0.85)', zIndex: 20 }}
                  >
                    <div style={{ textAlign: 'center' }}>
                      <PlayCircleOutlined style={{ fontSize: 54, color: "#3b82f6", marginBottom: 16 }} />
                      <Text style={{ color: "#f8fafc", fontSize: 24, fontWeight: 700, display: "block", marginBottom: 8 }}>
                        Join Video Sync
                      </Text>
                      <Text style={{ color: "#94a3b8", fontSize: 16, display: "block", marginBottom: 24 }}>
                        Click below to enter the video feed
                      </Text>
                      <Button
                        type="primary" size="large"
                        onClick={() => {
                          setGuestInteracted(true);
                          message.success("تم الدخول إلى البث المباشر للأدمن");
                        }}
                        style={{
                          height: 50, padding: '0 32px', fontSize: 18, borderRadius: 25,
                          background: "linear-gradient(135deg, #2563eb, #7c3aed)", border: "none",
                          boxShadow: "0 4px 14px rgba(37, 99, 235, 0.4)"
                        }}
                      >
                        Click to Start
                      </Button>
                    </div>
                  </div>
                )}

                {/* Manual sync button for participants (Only shows after joining) */}
                {!isAdmin && guestInteracted && (
                  <div className="drive-sync-bar">
                    <Button
                      id="manual-sync-btn"
                      icon={<SyncOutlined />}
                      onClick={handleManualSync}
                      className="manual-sync-btn"
                    >
                      Sync with Admin
                    </Button>
                  </div>
                )}
              </div>

            ) : (
              <div className="react-player-wrapper">
                {playerType === "youtube" ? (
                  <YouTube
                    videoId={youtubeId}
                    opts={{
                      width: "100%",
                      height: "100%",
                      playerVars: {
                        autoplay: isPlaying ? 1 : 0,
                        controls: 1,
                        rel: 0,
                        modestbranding: 1,
                      },
                    }}
                    onReady={(e) => {
                      playerRef.current = e.target;
                      handleReady();
                    }}
                    onPlay={handlePlay}
                    onPause={handlePause}
                    onStateChange={(e) => {
                      // Custom sync if needed
                    }}
                    className="youtube-embed"
                    style={{ width: "100%", height: "100%" }}
                  />
                ) : reactPlayerUrl ? (
                  <video
                    ref={playerRef}
                    src={reactPlayerUrl}
                    controls
                    playsInline
                    preload="auto"
                    onPlay={handlePlay}
                    onPause={handlePause}
                    onSeeked={(e) => handleSeek(e.target.currentTime)}
                    onTimeUpdate={(e) => {
                      // Custom throttled progress tracking for native video
                      if (!isAdmin) {
                        if (!isSyncingRef.current) {
                          const localTime = e.target.currentTime;
                          const { isPlaying: expectedPlaying, currentTime, lastUpdated } = syncStateRef.current;
                          const elapsed = lastUpdated ? Math.max(0, (Date.now() - lastUpdated) / 1000) : 0;
                          const targetTime = expectedPlaying ? currentTime + elapsed : currentTime;
                          if (Math.abs(localTime - targetTime) > 3) {
                            e.target.currentTime = targetTime;
                          }
                        }
                      }
                    }}
                    onLoadedMetadata={handleReady}
                    onError={(e) => {
                      if (!reactPlayerUrl) return;
                      console.error("Native Video error:", e);
                      message.error("فشل في تحميل الفيديو. الرابط قد لا يكون مدعوماً من المتصفح.", 5);
                    }}
                    style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000', display: 'block' }}
                  />
                ) : (
                  <div className="player-loading-overlay" style={{ background: '#000' }}>
                    <Spin size="large" />
                    <span style={{ color: "#94a3b8", marginTop: 16, display: "block", fontSize: 16 }}>جاري جلب البث المباشر...</span>
                  </div>
                )}

                {/* Guest Join Overlay: Essential for breaking browser autoplay policies by enforcing a click */}
                {!isAdmin && !guestInteracted && (
                  <div
                    className="player-loading-overlay guest-join-overlay"
                    style={{
                      background: 'rgba(15, 23, 42, 0.85)',
                      zIndex: 20
                    }}
                  >
                    <div style={{ textAlign: 'center' }}>
                      <PlayCircleOutlined style={{ fontSize: 54, color: "#3b82f6", marginBottom: 16 }} />
                      <Text style={{ color: "#f8fafc", fontSize: 24, fontWeight: 700, display: "block", marginBottom: 8 }}>
                        Join Video Sync
                      </Text>
                      <Text style={{ color: "#94a3b8", fontSize: 16, display: "block", marginBottom: 24 }}>
                        Click below to sync your player with the host
                      </Text>
                      <Button
                        type="primary"
                        size="large"
                        onClick={() => {
                          setGuestInteracted(true);
                          if (syncStateRef.current.isPlaying) {
                            message.success("Synced with host!");
                            enforceGuestSync();
                          } else {
                            message.info("Video will start automatically when host starts it.");
                          }
                        }}
                        style={{
                          height: 50,
                          padding: '0 32px',
                          fontSize: 18,
                          borderRadius: 25,
                          background: "linear-gradient(135deg, #2563eb, #7c3aed)",
                          border: "none",
                          boxShadow: "0 4px 14px rgba(37, 99, 235, 0.4)"
                        }}
                      >
                        Click to Start
                      </Button>
                    </div>
                  </div>
                )}

                {/* Visual indicator for guests when the video is paused by host (only after they join) */}
                {!isAdmin && guestInteracted && !isPlaying && (
                  <div
                    className="player-loading-overlay wait-admin-overlay"
                    style={{
                      background: 'rgba(15, 23, 42, 0.4)',
                      pointerEvents: 'none',
                      backdropFilter: 'blur(2px)',
                      zIndex: 10
                    }}
                  >
                    <div style={{ background: 'rgba(0,0,0,0.6)', padding: '16px 32px', borderRadius: '12px', textAlign: 'center' }}>
                      <Text style={{ color: "#f8fafc", fontSize: 20, fontWeight: 600, display: "block" }}>
                        ⏸️ Paused by Host
                      </Text>
                      <Text style={{ color: "#cbd5e1", fontSize: 14 }}>
                        Waiting for host to resume...
                      </Text>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Chat Panel ──────────────────────────────────────────────── */}
        <div className="chat-panel">
          <div className="chat-header">
            <MessageOutlined style={{ color: "#3b82f6" }} />
            <span className="chat-title">Live Chat</span>
            {!chatEnabled && <span className="chat-disabled-badge">Disabled by host</span>}
            {chatEnabled && <span className="chat-online-badge">{messages.length > 0 ? "🟢 Active" : "⚪ Quiet"}</span>}
          </div>

          <div className="chat-messages">
            {!chatEnabled ? (
              <div className="chat-empty">
                <div className="chat-empty-content">
                  <MessageOutlined style={{ fontSize: 28, color: "#ef4444" }} />
                  <Text style={{ color: "#94a3b8", fontSize: 14 }}>Chat is Disabled</Text>
                </div>
              </div>
            ) : messages.length === 0 ? (
              <div className="chat-empty">
                <ThunderboltFilled className="chat-empty-thunder" />
                <div className="chat-empty-content">
                  <ThunderboltFilled className="chat-empty-icon" />
                  <Text style={{ color: "#cbd5e1", fontSize: 14, fontWeight: 500 }}>No messages yet</Text>
                  <Text style={{ color: "#64748b", fontSize: 12 }}>Say hello to start the conversation! 👋</Text>
                </div>
              </div>
            ) : (
              messages.map((msg, i) => {
                const isOwn = msg.user === username;
                const prevMsg = i > 0 ? messages[i - 1] : null;
                const isConsecutive = prevMsg && !prevMsg.isSystem && !msg.isSystem && prevMsg.user === msg.user;

                // System event notification (Instagram-style centered notice)
                if (msg.isSystem) {
                  return (
                    <div key={msg.id || i} className="chat-event-notice">
                      <span className="chat-event-text">{msg.text}</span>
                    </div>
                  );
                }

                const emojiRegex = /^(\p{Extended_Pictographic}|\p{Regional_Indicator}|[\uFE0F\u200D\s]|[0-9#*]\uFE0F\u20E3)+$/u;
                const isEmojiOnly = msg.text && msg.text.trim().length > 0 && emojiRegex.test(msg.text);

                return (
                  <div key={msg.id || i} className={`chat-message ${isOwn ? "chat-message-own" : ""} ${isConsecutive ? "chat-message-consecutive" : ""} slide-in-right`} style={{ marginTop: isConsecutive ? -6 : 0 }}>
                    {!isOwn && (
                      <div className="chat-avatar" style={{ visibility: isConsecutive ? "hidden" : "visible" }}>
                        {msg.user?.[0]?.toUpperCase() || "?"}
                      </div>
                    )}
                    <div className="chat-bubble-group">
                      {!isOwn && !isConsecutive && <span className="chat-username">{msg.user}</span>}

                      {/* Quoted reply preview (shown inside the bubble group) */}
                      {msg.replyTo && (
                        <div className={`chat-reply-quote ${isOwn ? "chat-reply-quote-own" : ""}`}>
                          <div className="chat-reply-quote-bar" />
                          <div className="chat-reply-quote-body">
                            <span className="chat-reply-quote-user">{msg.replyTo.user}</span>
                            <span className="chat-reply-quote-text">{msg.replyTo.text}</span>
                          </div>
                        </div>
                      )}

                      <div className={`chat-bubble-row ${isOwn ? "chat-bubble-row-own" : ""}`}>
                        <div className={`chat-bubble ${isOwn ? "chat-bubble-own" : ""} ${isEmojiOnly ? "chat-bubble-emoji-only" : ""}`}>
                          <span className="chat-text">{msg.text}</span>
                          <span className="chat-time">{formatTime(msg.timestamp)}</span>
                        </div>

                        {/* Action buttons: 3 dots menu (for all messages when chat enabled) */}
                        {(chatEnabled && !isMuted) && (
                          <div className="chat-msg-react-wrap">
                            <Popover
                              content={getMessageOptionsContent(msg, isOwn)}
                              trigger="click"
                              placement="top"
                              open={activeMessageId === msg.id}
                              onOpenChange={(v) => setActiveMessageId(v ? msg.id : null)}
                              overlayInnerStyle={{ background: 'rgba(15, 23, 42, 0.85)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '16px', padding: 0, overflow: 'hidden' }}
                            >
                              <MoreOutlined className="chat-msg-options-icon" />
                            </Popover>
                          </div>
                        )}
                      </div>

                      {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                        <div className={`chat-reactions-display ${isOwn ? "chat-reactions-own" : ""}`}>
                          {(() => {
                            const rxCounts = {};
                            Object.values(msg.reactions).forEach(e => rxCounts[e] = (rxCounts[e] || 0) + 1);
                            return Object.entries(rxCounts).map(([em, count]) => (
                              <span key={em} className="chat-reaction-pill" title={em}>
                                {em} {count > 1 && <span className="reaction-count">{count}</span>}
                              </span>
                            ));
                          })()}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Reply preview bar — shown above the input when replying */}
          {replyTo && (
            <div className="chat-reply-preview-bar">
              <div className="chat-reply-preview-content">
                <div className="chat-reply-preview-indicator" />
                <div className="chat-reply-preview-text">
                  <span className="chat-reply-preview-user">{replyTo.user}</span>
                  <span className="chat-reply-preview-msg">{replyTo.text}</span>
                </div>
              </div>
              <button
                className="chat-reply-preview-close"
                onClick={() => setReplyTo(null)}
                title="Cancel reply"
              >
                <CloseOutlined />
              </button>
            </div>
          )}
          <div className="chat-input-bar">
            <Input
              id="chat-input"
              placeholder={replyTo ? `Replying to ${replyTo.user}…` : !chatEnabled ? "Chat is disabled" : isMuted ? "You have been muted" : "Type a message…"}
              value={chatInput}
              onChange={handleChatInputChange}
              onPressEnter={(chatEnabled && !isMuted) ? handleSendMessage : undefined}
              disabled={!chatEnabled || isMuted}
              style={{ flex: 1, background: "#060612", borderColor: replyTo ? "rgba(59,130,246,0.4)" : isMuted ? "rgba(239,68,68,0.3)" : "#1f1f2e" }}
            />
            <Button
              id="send-msg-btn"
              type="primary"
              icon={<SendOutlined />}
              onClick={handleSendMessage}
              disabled={!chatInput.trim() || !chatEnabled}
              className="send-btn"
              style={{ background: "linear-gradient(135deg, #2563eb, #7c3aed)", border: "none" }}
            />
          </div>
        </div>
      </div>

      {/* ── Participants Panel ─────────────────────────────────────────────── */}
      {participantsPanelOpen && (
        <div className="participants-panel-overlay" onClick={() => setParticipantsPanelOpen(false)}>
          <div className="participants-panel" onClick={(e) => e.stopPropagation()}>
            <div className="participants-panel-header">
              <div className="participants-panel-title">
                <TeamOutlined style={{ color: "#3b82f6", fontSize: 16 }} />
                <span>Participants</span>
                <span className="participants-panel-count">{participantCount}/{capacity}</span>
              </div>
              <button className="participants-panel-close" onClick={() => setParticipantsPanelOpen(false)}>✕</button>
            </div>
            <div className="participants-panel-list">
              {participants.length === 0 ? (
                <div className="participants-empty">No participants yet.</div>
              ) : (
                participants.map((p) => {
                  const isMe = p.name === username;
                  // isHost comes from Firebase presence — visible to ALL viewers, not just admin
                  const isHost = !!p.isAdmin;
                  return (
                    <div key={p.key} className={`participant-item ${isMe ? "participant-item-me" : ""}`}>
                      {/* Avatar: golden crown for host, blue person icon for guests */}
                      <div className={`participant-avatar ${isHost ? "participant-avatar-host" : ""}`}>
                        {isHost
                          ? <CrownOutlined style={{ fontSize: 15 }} />
                          : <UserOutlined style={{ fontSize: 14 }} />
                        }
                      </div>
                      <div className="participant-info">
                        <span className="participant-name">{p.name}</span>
                        {isMe && !isHost && <span className="participant-you-badge">You</span>}
                        {isHost && <span className="participant-host-badge"><CrownOutlined /> Host</span>}
                      </div>
                      {isAdmin && !isMe && (
                        <div className="participant-actions">
                          {/* Mute toggle: paper-plane+ban when NOT muted, plain paper-plane when muted */}
                          {mutedKeys.has(p.key) ? (
                            <Tooltip title="Unmute">
                              <button
                                className="participant-action-btn participant-unmute-btn"
                                onClick={() => handleMuteParticipant(p.key, p.name)}
                              >
                                <SendOutlined />
                              </button>
                            </Tooltip>
                          ) : (
                            <Tooltip title="Mute (disable chat)">
                              <button
                                className="participant-action-btn participant-mute-btn"
                                onClick={() => handleMuteParticipant(p.key, p.name)}
                              >
                                <span className="mute-icon-wrap">
                                  <SendOutlined />
                                  <span className="no-sign" />
                                </span>
                              </button>
                            </Tooltip>
                          )}
                          {/* Kick: door/logout icon */}
                          <Tooltip title="Kick from room">
                            <button
                              className="participant-action-btn participant-kick-btn"
                              onClick={() => handleKickParticipant(p.key, p.name)}
                            >
                              <LogoutOutlined />
                            </button>
                          </Tooltip>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Share Modal ──────────────────────────────────────────────────── */}
      <Modal
        title={<span style={{ color: "#e2e8f0", fontWeight: 700 }}><ShareAltOutlined style={{ marginRight: 8, color: "#3b82f6" }} />Share This Room</span>}
        open={shareModalOpen}
        onCancel={() => setShareModalOpen(false)}
        footer={null}
        centered
        width={420}
        className="share-modal"
      >
        <div className="share-modal-body">
          <Text style={{ color: "#64748b", display: "block", marginBottom: 6 }}>{roomName}</Text>
          <Text style={{ color: "#334155", fontSize: 12, display: "block", marginBottom: 14 }}>
            {participantCount}/{capacity} participants · {roomData?.privacy === "private" ? "🔒 Private" : "🌐 Public"}
          </Text>
          <div className="share-room-id">
            <span className="share-room-id-text">{roomId}</span>
            <Button id="copy-room-id-btn" icon={<CopyOutlined />} onClick={handleCopyRoomId} type="text" style={{ color: "#3b82f6" }}>Copy</Button>
          </div>
          <Text style={{ color: "#64748b", display: "block", margin: "20px 0 12px" }}>Or share the link</Text>
          <Button
            id="copy-link-btn"
            type="primary"
            icon={<LinkOutlined />}
            block
            onClick={handleCopyLink}
            style={{ height: 44, background: "linear-gradient(135deg, #2563eb, #7c3aed)", border: "none" }}
          >
            Copy Room Link
          </Button>
          <Text style={{ color: "#334155", fontSize: 12, display: "block", marginTop: 16, textAlign: "center" }}>
            Room capacity: {capacity}
          </Text>
        </div>
      </Modal>
    </div>
  );
}
