# 🎙️ Miko SFX Soundboard Bot

A lightweight, local-hosted Discord soundboard companion designed to run seamlessly alongside your primary music bot. 

## Features
- **12-Slot Interactive Dashboard:** Upload, rename, and manage local `.mp3`/`.wav` files.
- **Independent Volume Mixing:** A Master Volume slider, plus individual volume sliders for every single slot to mix audio perfectly.
- **Local HTTP Bypass Stream:** Uploaded files bypass Discord's strict absolute file path blocks by streaming through a local Express tunnel.
- **Playback History:** Live tracking of the last 10 sound effects deployed.
- **Unified Standby Hub:** Compatible with Miko Music Bot to share a single text-channel Command Center without UI collision.

## Installation & Running
1. Run `npm install`
2. Populate the `.env` file with your `DISCORD_TOKEN` and `CLIENT_ID`.
3. Run using `node server.js` or install as a background service via NSSM.
4. Access the dashboard at `http://localhost:3001`
