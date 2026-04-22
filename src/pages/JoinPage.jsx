import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Input,
  Button,
  Modal,
  message,
  Typography,
  Spin,
  Empty,
  Badge,
} from "antd";
import {
  SearchOutlined,
  LockOutlined,
  ArrowLeftOutlined,
  PlayCircleOutlined,
  UsergroupAddOutlined,
  YoutubeOutlined,
  LinkOutlined,
  VideoCameraOutlined,
  GlobalOutlined,
  TeamOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { db } from "../firebase";
import { ref, onValue, get } from "firebase/database";
import { cleanupEmptyRooms } from "../utils/cleanup";
import "./JoinPage.css";

const { Title, Text } = Typography;

function detectVideoType(url) {
  if (!url) return "direct";
  if (/youtube\.com\/watch|youtu\.be\/|youtube\.com\/embed/.test(url))
    return "youtube";
  if (/drive\.google\.com/.test(url)) return "drive";
  return "direct";
}

function VideoSourceIcon({ url }) {
  const type = detectVideoType(url);
  if (type === "youtube")
    return (
      <span className="source-chip youtube">
        <YoutubeOutlined /> YouTube
      </span>
    );
  if (type === "drive")
    return (
      <span className="source-chip drive">
        <LinkOutlined /> Drive
      </span>
    );
  return (
    <span className="source-chip direct">
      <VideoCameraOutlined /> Direct
    </span>
  );
}

export default function JoinPage() {
  const navigate = useNavigate();
  const [publicRooms, setPublicRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  const [privateModalOpen, setPrivateModalOpen] = useState(false);
  const [privateCode, setPrivateCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [joiningRoomId, setJoiningRoomId] = useState(null);

  // Run initial cleanup of stale empty rooms on page mount
  useEffect(() => {
    cleanupEmptyRooms();
  }, []);

  // Real-time public rooms listener
  useEffect(() => {
    const roomsRef = ref(db, "rooms");
    const unsub = onValue(roomsRef, (snap) => {
      const data = snap.val();
      if (data) {
        const list = Object.entries(data)
          .map(([id, room]) => {
            const presenceCount = room.presence
              ? Object.keys(room.presence).length
              : 0;
            return {
              id,
              ...room,
              presenceCount,
              isFull: presenceCount >= (room.capacity || 20),
            };
          })
          // Only show: public rooms that have at least 1 active participant
          .filter((r) => r.privacy === "public" && r.presenceCount > 0)
          .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        setPublicRooms(list);
      } else {
        setPublicRooms([]);
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // Filtered rooms by search
  const filteredRooms = publicRooms.filter(
    (r) =>
      r.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.id?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Join a public room directly
  const handleJoinPublic = (room) => {
    if (room.isFull) return;
    navigate(`/room/${room.id}`);
  };

  // Validate + join private room
  const handleJoinPrivate = async () => {
    const code = privateCode.trim().toUpperCase();
    if (!code) return message.warning("Please enter a Room Code");
    setJoining(true);
    try {
      const snap = await get(ref(db, `rooms/${code}`));
      if (!snap.exists()) {
        message.error("Room not found. Check the code and try again.");
      } else {
        const room = snap.val();
        const count = room.presence ? Object.keys(room.presence).length : 0;
        if (count >= (room.capacity || 20)) {
          message.error({
            content: `🚫 Room is full! (${count}/${room.capacity || 20})`,
            duration: 4,
          });
        } else {
          setPrivateModalOpen(false);
          navigate(`/room/${code}`);
        }
      }
    } catch (err) {
      message.error("Could not connect. Check your connection.");
      console.error(err);
    } finally {
      setJoining(false);
    }
  };

  // Join Now button on card (with loading state per card)
  const handleCardJoin = async (room) => {
    if (room.isFull) return;
    setJoiningRoomId(room.id);
    await new Promise((r) => setTimeout(r, 300)); // brief ripple delay
    setJoiningRoomId(null);
    navigate(`/room/${room.id}`);
  };

  return (
    <div className="join-page">
      {/* Background */}
      <div className="join-bg">
        <div className="j-orb j-orb-1" />
        <div className="j-orb j-orb-2" />
        <div className="j-orb j-orb-3" />
        <div className="j-grid" />
      </div>

      {/* Content */}
      <div className="join-content fade-in-up">
        {/* Header */}
        <div className="join-header">
          <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate("/")}
            className="join-back-btn"
          />
          <div className="join-header-brand">
            <PlayCircleOutlined style={{ color: "#3b82f6", fontSize: 20 }} />
            <span className="join-brand-name">WatchParty</span>
          </div>
          <Title level={2} className="join-page-title">
            Find a Room
          </Title>
          <Text className="join-page-subtitle">
            Browse public rooms or enter a private code
          </Text>
        </div>

        {/* Private Room Button */}
        <div className="private-section">
          <button
            id="join-private-btn"
            className="private-room-btn"
            onClick={() => {
              setPrivateCode("");
              setPrivateModalOpen(true);
            }}
          >
            <LockOutlined className="private-btn-icon" />
            <div className="private-btn-text">
              <span className="private-btn-label">Join Private Room</span>
              <span className="private-btn-hint">
                Enter a Room Code from the host
              </span>
            </div>
            <ArrowLeftOutlined
              style={{ transform: "rotate(180deg)", color: "#60a5fa" }}
            />
          </button>
        </div>

        {/* Divider */}
        <div className="section-divider">
          <div className="divider-line" />
          <span className="divider-label">
            <GlobalOutlined /> Public Rooms
          </span>
          <div className="divider-line" />
        </div>

        {/* Search */}
        <div className="search-section">
          <Input
            id="search-input"
            size="large"
            placeholder="Search by room name or ID…"
            prefix={
              <SearchOutlined style={{ color: "rgba(148,163,184,0.6)" }} />
            }
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            allowClear
            className="room-search-input"
          />
        </div>

        {/* Room List */}
        <div className="rooms-grid-section">
          {loading ? (
            <div className="rooms-loading">
              <Spin size="large" />
              <Text style={{ color: "#475569", marginTop: 14 }}>
                Loading rooms…
              </Text>
            </div>
          ) : filteredRooms.length === 0 ? (
            <div className="rooms-empty">
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <Text style={{ color: "#334155" }}>
                    {searchQuery
                      ? `No public rooms matching "${searchQuery}"`
                      : "No public rooms available right now"}
                  </Text>
                }
              />
              <Text
                style={{
                  color: "#1e2535",
                  fontSize: 13,
                  display: "block",
                  marginTop: 8,
                }}
              >
                Create one or ask a friend to set their room to Public
              </Text>
            </div>
          ) : (
            <div className="rooms-grid">
              {filteredRooms.map((room) => (
                <div
                  key={room.id}
                  className={`room-card ${room.isFull ? "room-card-full" : ""}`}
                >
                  {/* Card Header */}
                  <div className="rc-header">
                    <div className="rc-title-row">
                      <span className="rc-name">{room.name || room.id}</span>
                      {room.isFull && (
                        <Badge status="error" text="Full" className="rc-full-badge" />
                      )}
                    </div>
                    <VideoSourceIcon url={room.videoUrl} />
                  </div>

                  {/* Card Body */}
                  <div className="rc-body">
                    <div className="rc-capacity">
                      <TeamOutlined style={{ color: "#60a5fa" }} />
                      <span className="rc-capacity-text">
                        {room.presenceCount} / {room.capacity || 20}
                      </span>
                      <div
                        className="rc-capacity-bar"
                        style={{
                          "--fill": `${Math.min(
                            (room.presenceCount / (room.capacity || 20)) * 100,
                            100
                          )}%`,
                          "--color": room.isFull ? "#ef4444" : "#3b82f6",
                        }}
                      >
                        <div className="rc-capacity-fill" />
                      </div>
                    </div>
                    <Text className="rc-id">ID: {room.id}</Text>
                  </div>

                  {/* Card Footer */}
                  <button
                    className={`rc-join-btn ${
                      room.isFull ? "rc-join-disabled" : "rc-join-active"
                    }`}
                    disabled={room.isFull}
                    onClick={() => handleCardJoin(room)}
                  >
                    {joiningRoomId === room.id ? (
                      <Spin size="small" />
                    ) : room.isFull ? (
                      "Room Full"
                    ) : (
                      <>
                        <PlayCircleOutlined /> Join Now
                      </>
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Private Room Modal */}
      <Modal
        open={privateModalOpen}
        onCancel={() => setPrivateModalOpen(false)}
        footer={null}
        centered
        width={420}
        className="private-modal"
        destroyOnClose
        title={
          <div className="private-modal-title">
            <LockOutlined style={{ color: "#3b82f6", fontSize: 18 }} />
            <span>Join Private Room</span>
          </div>
        }
      >
        <div className="private-modal-body">
          <Text className="private-modal-desc">
            Enter the Room Code shared by the host
          </Text>
          <Input
            id="private-code-input"
            placeholder="e.g. ABC123"
            value={privateCode}
            onChange={(e) => setPrivateCode(e.target.value.toUpperCase())}
            onPressEnter={handleJoinPrivate}
            size="large"
            maxLength={10}
            className="private-code-input"
          />
          <div className="private-modal-actions">
            <Button
              id="cancel-private-btn"
              onClick={() => setPrivateModalOpen(false)}
              className="private-cancel-btn"
              size="large"
            >
              Cancel
            </Button>
            <Button
              id="confirm-private-btn"
              type="primary"
              size="large"
              loading={joining}
              onClick={handleJoinPrivate}
              className="private-confirm-btn"
            >
              Confirm
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
