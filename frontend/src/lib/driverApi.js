import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

// Dedicated instance for the MyEVRental driver app.
// withCredentials:true is kept for web fallback, but we primarily use Bearer tokens
// from localStorage to ensure persistence on Capacitor mobile app restarts.
const dapi = axios.create({ baseURL: API, withCredentials: true });

dapi.interceptors.request.use((config) => {
  const token = localStorage.getItem("driver_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default dapi;
