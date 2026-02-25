# Home Assistant Integration for Ummon UI

## Panel Authentication Settings

In the Home Assistant panel in Ummon UI, users can configure authentication to their Home Assistant instance:

- **Host/IP:**
  - Enter the IP address or hostname of the Home Assistant server.
  - Optionally include a port (e.g., `192.168.1.10:8123`).

- **Authentication Token:**
  - Enter a Home Assistant "long-lived access token" for secure API access.
  - Token is stored securely and used for all entity fetch/control operations.

### Example UI

```
+---------------- Home Assistant Connection ----------------+
| Host/IP: [__________________________]                   |
| Token:   [__________________________]                   |
| [Save] [Test Connection]                                |
+---------------------------------------------------------+
```

- The panel should allow users to test the connection and validate the token.
- All entity and control operations use this configuration for authentication.

---

## Home Assistant Entity Panel for Ummon UI

### Overview

A user-friendly panel in Ummon UI to manage Home Assistant entities exposed to the Glyph system. Entities are selected using a label (e.g., `glyph`) in Home Assistant. The panel allows configuration and override of key properties for each entity. The label name is configurable. 

---

### Workflow

1. **Labeling in Home Assistant**
   - User adds a label/tag (e.g., `glyph`) to any entity they want to expose.

2. **Ummon UI Panel**
   - Add a “Home Assistant Entities” panel in Ummon UI.
   - On load, fetch all Home Assistant entities with the `glyph` label via the integration.

3. **Entity List & Configuration**
   - Display a list of labeled entities.
   - For each entity, show:
     - **Device** (friendly name)
     - **Domain** (auto-filled from device class, editable)
     - **Intent** (editable)
     - **Urgency** (default, editable)
     - **Triggers** (entity state with operators (=,!=,<,>,etc.. ))
     - **TTL** (in seconds)
   - Allow user to override domain, intent, urgency, and state mappings as needed.

4. **Save/Sync**
   - Save overrides/config in Ummon UI (local storage, backend, or push back to Home Assistant as custom attributes).

---

### Wireframe

```
+-------------------------------------------------------------+
|           Home Assistant Entities Exposed to Glyphs         |
+-------------------------------------------------------------+
| [Refresh]                                                   |
+-------------------------------------------------------------+
| Device Name      | Domain   | Intent   | Urgency | State → Glyph Mapping | [Edit] |
|------------------|----------|----------|---------|----------------------|--------|
| Living Room Temp | sensor   | report   | normal  | >25°C → 🔥           | [⚙️]   |
| Front Door       | door     | open     | urgent  | open → 🚨           | [⚙️]   |
| Hallway Light    | light    | toggle   | normal  | on → 💡, off → 🌑    | [⚙️]   |
+------------------+----------+----------+---------+----------------------|--------+
| [Add Entity]                                                    |
+-------------------------------------------------------------+
```

**Edit Modal Example:**

```
+---------------- Edit Entity ----------------+
| Device Name: [Living Room Temp]             |
| Domain:      [sensor   v]                   |
| Intent:      [report   v]                   |
| Urgency:     [normal   v]                   |
| State → Glyph Mapping:                      |
|   [state: >25°C] → [glyph: 🔥]              |
|   [state: <18°C] → [glyph: ❄️]              |
|   [Add Mapping]                             |
|                                             |
| [Save] [Cancel]                             |
+---------------------------------------------+
```

---

### Benefits

- **Simplicity:** User only needs to label entities in Home Assistant.
- **Flexibility:** All advanced config is optional and handled in one place (Ummon UI).
- **Transparency:** User sees exactly what’s exposed and how it’s mapped.

---

### Rule Configuration for Glyph Creation

For each exposed sensor, users must be able to define rules that determine when a glyph should be created. Each rule consists of:

- **State Type:**  
  - String (e.g., "on", "open", "detected")
  - Number (e.g., temperature, humidity)

- **Operator:**  
  - For strings: `=`, `!=`
  - For numbers: `=`, `!=`, `<`, `>`, `<=`, `>=`

- **Value:**  
  - The state value to compare against.

- **Glyph Mapping:**  
  - The glyph to create when the rule matches.

#### Example Rule Table

| State Type | Operator | Value   | Glyph   |
|------------|----------|---------|---------|
| String     | =        | "open"  | 🚨      |
| Number     | >        | 25      | 🔥      |
| Number     | <=       | 18      | ❄️      |

#### UI Suggestion

- In the entity edit modal, provide a section to add/edit/delete rules.
- Each rule row allows selection of state type, operator, value, and glyph.

---

**This rule system enables flexible and precise control over when glyphs are created based on sensor states.**

---

### Next Steps

- Design API for fetching labeled entities from Home Assistant.
- Scaffold the UI panel in Ummon UI.
- Define config storage and sync strategy.

---

**This enables secure, user-friendly integration between Ummon UI and Home Assistant.**
