// Local Vite proxies /v1 to the backend; production talks to the hosted API.
export const API_URL = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? '' : 'https://gizu-app.onrender.com')
