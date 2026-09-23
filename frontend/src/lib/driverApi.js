import axios from "axios";

import { Preferences } from '@capacitor/preferences';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

// Dedicated instance for the MyEVRental driver app.
// We primarily use Bearer tokens from native Capacitor Preferences 
// to ensure perfect persistence on mobile app hard-restarts.
const dapi = axios.create({ baseURL: API, withCredentials: true });

dapi.interceptors.request.use(async (config) => {
  const { value } = await Preferences.get({ key: "driver_token" });
  if (value) {
    config.headers.Authorization = `Bearer ${value}`;
  }
  return config;
});

export default dapi;
