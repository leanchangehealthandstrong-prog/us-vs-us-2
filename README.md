# Us vs Us 2.0 — Online Multiplayer

Real-time two-player browser game using Node.js + WebSocket.

## Run locally
1. Install Node.js.
2. In this folder run:
   npm install ws
   node server.js
3. Open http://localhost:3000
4. For two phones on the same Wi‑Fi, open the computer's local IP and port 3000.

## Public online play
Deploy this project to a Node-compatible host that supports WebSockets. Then share the public URL. Player 1 creates a room and sends the 5-character code to Player 2.

Note: this starter version stores rooms in memory; restarting the server clears rooms.
