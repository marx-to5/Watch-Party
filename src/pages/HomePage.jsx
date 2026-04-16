import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Input, Modal, Switch, message, Typography, Spin } from "antd";
import {
  VideoCameraOutlined,
  UsergroupAddOutlined,
  PlayCircleOutlined,
  ThunderboltOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  LoadingOutlined,
  GlobalOutlined,
  LockOutlined,
  MessageOutlined,
  TeamOutlined,
  LinkOutlined,
  YoutubeOutlined,
} from "@ant-design/icons";
import { db } from "../firebase";
import { ref, set, get } from "firebase/database";
import { cleanupEmptyRooms } from "../utils/cleanup";
import "./HomePage.css";

const { Title, Text } = Typography;

const CAPACITY_OPTIONS = [2, 4, 8, 16, 20];

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// ── Video URL validation ───────────────────────────────────────────────────────
function detectVideoType(url) {
  if (!url) return null;
  if (/youtube\.com\/watch|youtu\.be\/|youtube\.com\/embed/.test(url)) return "youtube";
  if (/drive\.google\.com/.test(url)) return "drive";
  if (/\.(mp4|webm|ogg|mov|mkv|avi|m3u8)(\?.*)?$/i.test(url)) return "direct";
  return null;
}

function extractDriveFileId(url) {
  const fileMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch) return fileMatch[1];
  const idMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idMatch) return idMatch[1];
  return null;
}

function convertUrlForPlayer(url, type) {
  if (!url) return "";
  if (type === "youtube") {
    // Store as standard watch URL — ReactPlayer handles conversion internally
    const match = url.match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/);
    return match ? `https://www.youtube.com/watch?v=${match[1]}` : url;
  }
  if (type === "drive") {
    // Convert to direct stream URL so ReactPlayer treats it as HTML5 video (enables sync)
    const id = extractDriveFileId(url);
    return id ? `https://drive.google.com/uc?export=download&id=${id}` : url;
  }
  return url;
}

// Validate: check URL structure, no actual HTTP fetch needed
function validateVideoUrl(url) {
  return new Promise((resolve) => {
    setTimeout(() => {
      const type = detectVideoType(url);
      resolve(type ? { valid: true, type } : { valid: false, type: null });
    }, 800); // simulate async check
  });
}

export default function HomePage() {
  const navigate = useNavigate();

  // Clean up stale empty rooms every time the home page is visited
  useEffect(() => { cleanupEmptyRooms(); }, []);

  // ── Create modal state ──────────────────────────────────────────────────────
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [capacity, setCapacity] = useState(8);
  const [chatEnabled, setChatEnabled] = useState(true);
  const [privacy, setPrivacy] = useState("public");
  const [videoRaw, setVideoRaw] = useState("");
  const [videoStatus, setVideoStatus] = useState("idle"); // idle | checking | valid | invalid
  const [videoType, setVideoType] = useState(null);
  const [creating, setCreating] = useState(false);
  const debounceRef = useRef(null);

  // Reset create modal
  const resetCreateModal = () => {
    setRoomName("");
    setCapacity(8);
    setChatEnabled(true);
    setPrivacy("public");
    setVideoRaw("");
    setVideoStatus("idle");
    setVideoType(null);
  };

  // ── Video URL debounced validation ──────────────────────────────────────────
  const handleVideoInput = useCallback((e) => {
    const val = e.target.value;
    setVideoRaw(val);
    setVideoStatus("idle");
    setVideoType(null);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!val.trim()) return;

    setVideoStatus("checking");
    debounceRef.current = setTimeout(async () => {
      const result = await validateVideoUrl(val.trim());
      setVideoStatus(result.valid ? "valid" : "invalid");
      setVideoType(result.type);
    }, 600);
  }, []);

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  // ── Create Room ─────────────────────────────────────────────────────────────
  const handleOpenRoom = async () => {
    if (videoStatus !== "valid") return;
    setCreating(true);
    try {
      const roomId = generateRoomId();
      const convertedUrl = convertUrlForPlayer(videoRaw.trim(), videoType);
      await set(ref(db, `rooms/${roomId}`), {
        name: roomName.trim() || `Room ${roomId}`,
        capacity,
        chatEnabled,
        privacy,
        videoUrl: convertedUrl,
        createdAt: Date.now(),
        messages: {},
        presence: {},
      });
      message.success({ content: `Room ${roomId} created! 🎉`, duration: 2 });
      setCreateModalOpen(false);
      resetCreateModal();
      navigate(`/room/${roomId}?admin=true`);
    } catch (err) {
      message.error("Failed to create room. Check Firebase config.");
      console.error(err);
    } finally {
      setCreating(false);
    }
  };

  // ── Status icon for video input ─────────────────────────────────────────────
  const VideoStatusIcon = () => {
    if (videoStatus === "checking") return <LoadingOutlined className="video-status-icon checking" spin />;
    if (videoStatus === "valid") return <CheckCircleFilled className="video-status-icon valid" />;
    if (videoStatus === "invalid") return <CloseCircleFilled className="video-status-icon invalid" />;
    return null;
  };

  // Source badge
  const SourceBadge = () => {
    if (videoType === "youtube") return <span className="source-badge youtube"><YoutubeOutlined /> YouTube</span>;
    if (videoType === "drive") return <span className="source-badge drive"><LinkOutlined /> Google Drive</span>;
    if (videoType === "direct") return <span className="source-badge direct"><VideoCameraOutlined /> Direct Link</span>;
    return null;
  };

  return (
    <div className="home-page">
      {/* Animated background */}
      <div className="home-bg">
        <div className="orb orb-1" />
        <div className="orb orb-2" />
        <div className="orb orb-3" />
        <div className="grid-overlay" />
      </div>

      <div className="home-content fade-in-up">
        {/* Brand */}
        <div className="brand">
          <div className="brand-icon"><PlayCircleOutlined /></div>
          <Title level={1} className="brand-title">
            Watch<span className="brand-accent">Party</span>
          </Title>
          <Text className="brand-tagline">Stream together. Feel the vibe. 🎬</Text>
        </div>

        {/* Feature pills */}
        <div className="feature-pills">
          <span className="pill"><ThunderboltOutlined /> Real-time sync</span>
          <span className="pill"><VideoCameraOutlined /> HD Streaming</span>
          <span className="pill"><UsergroupAddOutlined /> Live Chat</span>
        </div>

        {/* Action buttons */}
        <div className="action-buttons">
          <Button
            id="create-room-btn"
            type="primary"
            size="large"
            icon={<PlayCircleOutlined />}
            onClick={() => setCreateModalOpen(true)}
            className="action-btn action-btn-primary"
          >
            Create Room
          </Button>
          <Button
            id="join-room-btn"
            size="large"
            icon={<UsergroupAddOutlined />}
            onClick={() => navigate("/join")}
            className="action-btn action-btn-secondary"
          >
            Join Room
          </Button>
        </div>

        <Text className="home-footer">
          No account needed — just share the Room ID and watch together
        </Text>
        <Text className="home-credit">
          Programmed by Farouk
        </Text>
      </div>

      {/* ── CREATE ROOM SETTINGS MODAL ─────────────────────────────────────── */}
      <Modal
        open={createModalOpen}
        onCancel={() => { setCreateModalOpen(false); resetCreateModal(); }}
        footer={null}
        centered
        width={520}
        className="create-modal"
        destroyOnClose
        title={
          <div className="create-modal-title">
            <PlayCircleOutlined style={{ color: "#3b82f6", fontSize: 20 }} />
            <span>Room Settings</span>
          </div>
        }
      >
        <div className="create-modal-body">

          {/* Room Name */}
          <div className="setting-group">
            <label className="setting-label">
              <TeamOutlined /> Room Name
            </label>
            <Input
              id="room-name-input"
              placeholder="e.g. Friday Night Movie Club"
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              size="large"
              className="setting-input"
              maxLength={50}
            />
          </div>

          {/* Capacity */}
          <div className="setting-group">
            <label className="setting-label">
              <UsergroupAddOutlined /> Room Capacity (Max Participants)
            </label>
            <div className="capacity-buttons">
              {CAPACITY_OPTIONS.map((cap) => (
                <button
                  key={cap}
                  id={`capacity-${cap}`}
                  className={`capacity-btn ${capacity === cap ? "capacity-btn-active" : ""}`}
                  onClick={() => setCapacity(cap)}
                >
                  {cap}
                </button>
              ))}
            </div>
          </div>

          {/* Video URL */}
          <div className="setting-group">
            <label className="setting-label">
              <VideoCameraOutlined /> Video URL
            </label>
            <div className="video-input-wrapper">
              <Input
                id="video-url-input"
                placeholder="YouTube, Google Drive, or direct video link…"
                value={videoRaw}
                onChange={handleVideoInput}
                size="large"
                className={`setting-input video-input ${videoStatus === "valid" ? "video-valid" : videoStatus === "invalid" ? "video-invalid" : ""}`}
                suffix={<VideoStatusIcon />}
              />
            </div>
            {/* Hint row */}
            <div className="video-hint-row">
              {videoStatus === "idle" && !videoRaw && (
                <Text className="video-hint">
                  Supports: <strong>YouTube</strong>, <strong>Google Drive</strong>, <strong>MP4/WebM</strong> links
                </Text>
              )}
              {videoStatus === "checking" && (
                <Text className="video-hint checking">Validating link…</Text>
              )}
              {videoStatus === "valid" && <><SourceBadge /><Text className="video-hint valid">Link detected and ready ✓</Text></>}
              {videoStatus === "invalid" && (
                <Text className="video-hint invalid">
                  Unsupported link. Try a YouTube URL or Google Drive share link.
                </Text>
              )}
            </div>
          </div>

          {/* Toggles row */}
          <div className="toggles-row">
            {/* Chat */}
            <div className="toggle-card">
              <div className="toggle-card-icon chat-icon"><MessageOutlined /></div>
              <div className="toggle-card-info">
                <span className="toggle-card-title">Live Chat</span>
                <span className="toggle-card-desc">{chatEnabled ? "Enabled" : "Disabled"}</span>
              </div>
              <Switch
                id="chat-toggle"
                checked={chatEnabled}
                onChange={setChatEnabled}
                className="custom-switch"
              />
            </div>

            {/* Privacy */}
            <div className="toggle-card">
              <div className="toggle-card-icon privacy-icon">
                {privacy === "public" ? <GlobalOutlined /> : <LockOutlined />}
              </div>
              <div className="toggle-card-info">
                <span className="toggle-card-title">Privacy</span>
                <span className="toggle-card-desc">{privacy === "public" ? "Public Room" : "Private Room"}</span>
              </div>
              <Switch
                id="privacy-toggle"
                checked={privacy === "private"}
                onChange={(v) => setPrivacy(v ? "private" : "public")}
                className="custom-switch"
                checkedChildren={<LockOutlined />}
                unCheckedChildren={<GlobalOutlined />}
              />
            </div>
          </div>

          {/* Open Room button */}
          <button
            id="open-room-btn"
            className={`open-room-btn ${videoStatus === "valid" ? "open-room-btn-active" : "open-room-btn-disabled"}`}
            disabled={videoStatus !== "valid" || creating}
            onClick={handleOpenRoom}
          >
            {creating ? (
              <><Spin indicator={<LoadingOutlined spin />} size="small" /> Opening…</>
            ) : (
              <><PlayCircleOutlined /> Open Room</>
            )}
          </button>

          <Text className="create-modal-footer">
            Room opens immediately — share the ID with your friends after
          </Text>
        </div>
      </Modal>

    </div>
  );
}
