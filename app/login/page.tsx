"use client";

import { useState } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        window.location.href = "/";
      } else {
        setError("Incorrect password. Please try again.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "#f7f7f5",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      <div style={{
        background: "#fff",
        border: "1px solid #e6e6e3",
        borderRadius: "12px",
        padding: "48px",
        width: "100%",
        maxWidth: "400px",
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
      }}>
        <div style={{ marginBottom: "32px", textAlign: "center" }}>
          <div style={{
            width: "48px",
            height: "48px",
            background: "#1a1a1a",
            borderRadius: "12px",
            margin: "0 auto 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "24px",
          }}>
            🎓
          </div>
          <h1 style={{ margin: 0, fontSize: "20px", fontWeight: 700, color: "#1a1a1a" }}>
            Contrarian Academy
          </h1>
          <p style={{ margin: "8px 0 0", fontSize: "14px", color: "#666" }}>
            Members Dashboard — Team Access
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: "16px" }}>
            <label style={{
              display: "block",
              fontSize: "13px",
              fontWeight: 500,
              color: "#1a1a1a",
              marginBottom: "6px",
            }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter team password"
              required
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid #e6e6e3",
                borderRadius: "8px",
                fontSize: "14px",
                color: "#1a1a1a",
                background: "#fff",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>

          {error && (
            <p style={{
              color: "#c0392b",
              fontSize: "13px",
              margin: "0 0 16px",
              padding: "10px 12px",
              background: "#fdf2f2",
              border: "1px solid #f5c6c6",
              borderRadius: "6px",
            }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "11px",
              background: loading ? "#666" : "#1a1a1a",
              color: "#fff",
              border: "none",
              borderRadius: "8px",
              fontSize: "14px",
              fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer",
              transition: "background 0.15s",
            }}
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
