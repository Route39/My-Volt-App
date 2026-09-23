/**
 * imgUrl - Convert a relative image path from the backend into a full URL.
 * 
 * Images are stored on the backend server as relative paths like:
 *   /uploads/kyc/abc123.jpg
 *   /uploads/odometer/xyz.jpg
 * 
 * This helper prepends the correct backend base URL so images always load
 * correctly, both in development (localhost:8000) and on the live server.
 */

import { API } from "./api";

export function imgUrl(path) {
  if (!path) return null;
  // Already a full URL (http/https) or a data URL - use as-is
  if (path.startsWith("http") || path.startsWith("data:")) return path;
  
  // If the path is a relative upload path, fetch it through the API router
  // Since the API router is properly proxied by Nginx to the backend,
  // this guarantees the image loads perfectly in production.
  if (path.startsWith("/uploads")) {
    return `${API}${path}`;
  }
  
  const BACKEND = process.env.REACT_APP_BACKEND_URL || "";
  return `${BACKEND}${path.startsWith("/") ? "" : "/"}${path}`;
}

export default imgUrl;
