# ChatWave-

A WhatsApp-inspired, direct-message MVP built with **React + Vite**, **Node.js + Express**, **MongoDB/Mongoose**, and **Socket.IO**. People can register, choose a unique `@username`, search for other users, and exchange realtime text messages.

## MVP features
- Email/password registration and sign-in (passwords hashed with bcrypt).
- Optional Google sign-in (Google Identity Services credential verification on the server).
- Unique public usernames: 3–20 letters, numbers, or underscores.
- Find any registered user by username and start a one-to-one chat.
- Persisted messages in MongoDB and realtime delivery through Socket.IO.
- Responsive desktop/mobile UI, chat list, timestamps, and sign-out.

## Project layout
- `backend/` — Express API, MongoDB models, JWT auth, Socket.IO server.
- `frontend/` — React/Vite client.

## Run locally
Requirements: Node.js 20+ and a MongoDB connection string.

1. Configure the backend:
   ```sh
   cd backend
   cp .env.example .env
   ```
   Set `MONGODB_URI` to your MongoDB Atlas URI and set `JWT_SECRET` to a long random secret. Set `CLIENT_ORIGIN=http://localhost:5173`. For Google sign-in, set `GOOGLE_CLIENT_ID` to the same OAuth web client ID used by the frontend.
2. Start the API:
   ```sh
   npm install
   npm run dev
   ```
   API defaults to `http://localhost:4000`.
3. In a second terminal, start the frontend:
   ```sh
   cd frontend
   npm install
   ```
   Create `frontend/.env.local`:
   ```env
   VITE_API_URL=http://localhost:4000
   VITE_SOCKET_URL=http://localhost:4000
   VITE_GOOGLE_CLIENT_ID=your-google-web-client-id.apps.googleusercontent.com
   ```
   Then run `npm run dev` and open `http://localhost:5173`.

Email sign-in works without Google OAuth configuration. Google sign-in requires the matching OAuth client ID on both sides and the appropriate authorized JavaScript origin in Google Cloud Console.

## Deployment
Deploy `backend/` as a persistent Node service that supports WebSockets (for example, Render or Railway), and `frontend/` as a static Vite site (for example, Vercel). Configure:
- Backend: `MONGODB_URI`, a strong `JWT_SECRET`, `CLIENT_ORIGIN` (the exact deployed frontend origin), and optionally `GOOGLE_CLIENT_ID`.
- Frontend: `VITE_API_URL` and `VITE_SOCKET_URL` set to the deployed backend URL, and optionally `VITE_GOOGLE_CLIENT_ID`.
- Add the deployed frontend domain to the Google OAuth client's authorized JavaScript origins.

The backend uses Socket.IO and needs a runtime that stays online; a static-only serverless function is not sufficient for this realtime server. Restrict CORS to your real frontend origin in production. Never commit real secrets or a populated `.env` file.

## Current scope / limitations
This first version intentionally supports text-only one-to-one conversations. It does not yet include group chats, attachments, voice/video calls, end-to-end encryption, password reset/email verification, blocking/reporting, or delivery/read receipts. JWT is stored in browser local storage for this MVP; consider an HttpOnly-cookie session design and rate limiting before a public production launch. Anyone can register and discover usernames, so do not expose private information in display names or messages.
