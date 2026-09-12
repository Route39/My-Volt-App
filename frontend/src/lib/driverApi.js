import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

// Dedicated instance for the MyEVRental driver app.
// withCredentials:false so the MyVolt admin cookie is never sent — driver auth is bearer-only (ev_token).
const dapi = axios.create({ baseURL: API, withCredentials: false });

dapi.interceptors.request.use((config) => {
  const t = localStorage.getItem("ev_token");
  if (t) config.headers.Authorization = `Bearer ${t}`;
  return config;
});

export default dapi;
