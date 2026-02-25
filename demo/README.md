# Demo Payloads

Example glyph payloads covering every domain, status, and urgency level.

## Files

| File | Domain | What it shows |
|---|---|---|
| `appliance-dishwasher-done.json` | appliance | Dishwasher finished (green, solid block) |
| `appliance-washer-done.json` | appliance | Washer finished (green, solid block, different seed) |
| `appliance-dryer-done.json` | appliance | Dryer finished (green, solid block, different seed) |
| `security-front-door-warning.json` | security | Front door warning, urgency 2 (yellow, vertical bars) |
| `security-garage-error.json` | security | Garage error, urgency 3 (red, vertical bars, all corners) |
| `security-motion-critical.json` | security | Motion sensor critical, urgency 4 (red, blinking) |
| `climate-thermostat-attention.json` | climate | Thermostat attention, urgency 1 (yellow, cross) |
| `climate-hvac-running.json` | climate | HVAC running (purple, cross) |
| `media-tv-running.json` | media | TV playing (purple, diagonal) |
| `media-speaker-done.json` | media | Speaker done (green, diagonal) |
| `voice-listening.json` | voice | Listening state (cyan, wave/arcs, pulsing) |
| `voice-responding.json` | voice | Responding state (violet, wave/arcs, wave anim) |
| `system-idle-heartbeat.json` | system | Random idle heartbeat (blue, hollow, 5s TTL) |
| `system-error.json` | system | System error, urgency 3 (red, hollow, all corners) |
| `system-automation-running.json` | system | Automation running (purple, hollow) |

## Usage

### curl
```bash
curl -X POST http://localhost:3000/glyph \
  -H "Content-Type: application/json" \
  -d @demo/appliance-dishwasher-done.json
```

### PowerShell
```powershell
.\demo\send.ps1 appliance-dishwasher-done.json
.\demo\send.ps1 -All           # send every payload, 3s apart
.\demo\send.ps1 -Clear         # reset to idle
```

### Bash
```bash
./demo/send.sh demo/appliance-dishwasher-done.json
./demo/send.sh --all           # send every payload, 3s apart
./demo/send.sh --clear         # reset to idle
```

### Node-RED HTTP Request node
Set method to POST, URL to `http://<server>:3000/glyph`, and pass the JSON object as the payload.
