# Agents

How autonomous agents, bots, and external systems can interact with Ummon Glyph UI.

---

## Overview

Ummon exposes a small HTTP + SSE surface that any agent can use to push glyphs, read state, and react to display changes in real time. There is no agent runtime built into Ummon itself — it is a *display target*, not an orchestrator. Agents live outside and talk to it over the network.

---

## Integration Points

### Sending Glyphs

```
POST /glyph
Content-Type: application/json
X-API-Key: <your-key>
```

```json
{
  "domain": "security",
  "device": "front-door",
  "status": "warning",
  "intent": "alert",
  "urgency": 3,
  "ttl": 60
}
```

| Field | Required | Values |
|-------|----------|--------|
| `domain` | Yes | `appliance`, `system`, `security`, `climate`, `media`, `voice` |
| `device` | Depends | Required for `appliance`, `security`, `climate`, `media` |
| `status` | Yes | `done`, `idle`, `listening`, `responding`, `running`, `warning`, `error` |
| `intent` | Yes | `notification`, `idle`, `voice`, `automation`, `alert`, `status` |
| `urgency` | No | `0`–`5` (corner accents, blink at high levels) |
| `ttl` | No | Seconds before the glyph expires back to idle (default: `30`) |

### Clearing the Display

```
POST /clear
X-API-Key: <your-key>
```

Returns the display to its idle state immediately.

### Reading State

```
GET /api/state          # current glyph as JSON (public)
GET /api/message        # current display message (public)
GET /glyph.png          # current glyph as PNG (public)
```

### Subscribing to Events (SSE)

```
GET /events
```

The SSE stream emits `glyph` events whenever the display changes. An agent can hold a persistent connection and react to every state transition.

Example listener (Node.js):

```js
import EventSource from "eventsource";

const es = new EventSource("http://localhost:3000/events");

es.addEventListener("glyph", (e) => {
  const data = JSON.parse(e.data);
  console.log(`[${data.domain}] ${data.device} → ${data.status}`);
});
```

### MJPEG Stream

```
GET /glyph.mjpeg?fps=2&quality=80
```

Useful for agents that consume camera feeds or need a continuous visual representation.

---

## Agent Patterns

### Node-RED Agent

Node-RED is the most common way to build lightweight HA agents that feed Ummon. A typical flow:

1. **Trigger node** — listens to a Home Assistant entity state change
2. **Function node** — maps the event to glyph metadata
3. **HTTP Request node** — `POST /glyph` with the JSON payload

This keeps the mapping logic inside Node-RED while Ummon handles rendering.

### Home Assistant Automation Agent

The built-in HA integration (`/ha-admin`) already acts as a basic agent:

- Connects via WebSocket to Home Assistant
- Monitors labeled entities for state changes
- Evaluates trigger rules (`=`, `!=`, `<`, `>`, `<=`, `>=`)
- Fires glyphs automatically when rules match

Configure it through the admin panel — no code required.

### Polling Agent

For systems that cannot use SSE, a simple poll loop works:

```bash
while true; do
  curl -s http://localhost:3000/api/state | jq .
  sleep 5
done
```

### Webhook-Driven Agent

Point any webhook-capable service (IFTTT, Zapier, n8n, custom scripts) at `POST /glyph` with the appropriate payload and API key.

### Multi-Display Agent

Run multiple Ummon instances (one per display or room) and have a central agent route glyphs to the right instance based on location or context:

```js
const displays = {
  kitchen:    "http://kitchen-tablet:3000",
  bedroom:    "http://bedroom-tablet:3000",
  livingroom: "http://living-room-tablet:3000",
};

async function routeGlyph(room, payload) {
  await fetch(`${displays[room]}/glyph`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": process.env.UMMON_API_KEY,
    },
    body: JSON.stringify(payload),
  });
}
```

---

## Authentication

| Method | Header | Use Case |
|--------|--------|----------|
| API Key | `X-API-Key: <key>` | Agents posting glyphs or clearing the display |
| Admin Session | Cookie-based | Human users in the admin panel |

Set the API key via the `UMMON_API_KEY` environment variable. Public endpoints (`/api/state`, `/events`, `/glyph.png`, `/glyph.mjpeg`) require no authentication.

---

## Payload Reference

### Domains

| ID | Label | Requires Device | Description |
|----|-------|-----------------|-------------|
| `appliance` | Appliance | Yes | Kitchen & household appliances |
| `system` | System | No | Home Assistant system events |
| `security` | Security | Yes | Security sensors, locks, cameras |
| `climate` | Climate | Yes | Thermostats, HVAC, humidity |
| `media` | Media | Yes | TVs, speakers, media players |
| `voice` | Voice | No | Voice assistant interactions |

### Intents

| ID | Label | Description |
|----|-------|-------------|
| `notification` | Notification | Standard event notification |
| `idle` | Idle | System idle / ambient display |
| `voice` | Voice | Voice assistant interaction |
| `automation` | Automation | Triggered by an automation rule |
| `alert` | Alert | High-priority alert needing attention |
| `status` | Status | Ongoing status display |

### Status Colors

| Status | Color |
|--------|-------|
| `done` | Green |
| `idle` | Blue |
| `warning` | Yellow |
| `error` | Red |
| `running` | Purple (automation) |
| `listening` | Cyan |
| `responding` | Violet |

### Priority

When multiple glyphs compete, the intent priority decides which one wins:

`alert` > `voice` > `notification` > `automation` > `status` > `idle`

Higher-priority glyphs replace lower-priority ones. Equal or lower priority glyphs are queued until the active glyph expires.

---

## Tips

- **Keep TTLs short.** Agents should set `ttl` to match the expected duration of the event. A 5-second voice response doesn't need a 60-second TTL.
- **Use urgency sparingly.** Levels 4–5 cause blinking, which is intentionally attention-grabbing. Reserve high urgency for actual alerts.
- **Leverage determinism.** The same metadata always produces the same glyph. Users learn to recognize patterns — don't randomize fields unnecessarily.
- **Prefer the HA integration for simple rules.** Only build a custom agent when you need logic beyond basic state comparisons.
- **Monitor `/events` for feedback loops.** If your agent reacts to glyph changes, make sure it doesn't trigger itself.
