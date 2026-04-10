import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ConfigProvider, theme } from "antd";
import App from "./App";
import "./index.css";

const darkTheme = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: "#6366f1",
    colorBgBase: "#000000",
    colorBgContainer: "#0d0d0d",
    colorBgElevated: "#111111",
    colorBgLayout: "#000000",
    colorBorder: "#1f1f2e",
    colorBorderSecondary: "#1a1a2e",
    colorText: "#e2e8f0",
    colorTextSecondary: "#94a3b8",
    colorTextTertiary: "#64748b",
    borderRadius: 12,
    fontFamily: "'Inter', 'Segoe UI', sans-serif",
  },
  components: {
    Button: {
      colorPrimary: "#6366f1",
      colorPrimaryHover: "#818cf8",
      colorPrimaryActive: "#4f46e5",
      borderRadius: 10,
    },
    Input: {
      colorBgContainer: "#0a0a1a",
      colorBorder: "#1f1f2e",
      colorText: "#e2e8f0",
      borderRadius: 10,
    },
    Card: {
      colorBgContainer: "#0a0a1a",
      borderRadius: 16,
    },
    Modal: {
      colorBgElevated: "#0d0d1a",
    },
  },
};

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <ConfigProvider theme={darkTheme}>
        <App />
      </ConfigProvider>
    </BrowserRouter>
  </React.StrictMode>
);
