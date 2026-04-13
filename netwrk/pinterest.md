# Pinterest API Integration — Future Reference

netwrk currently uses Are.na (client-side OAuth PKCE). Pinterest **requires a backend server** because the OAuth flow uses a `client_secret` that must never be exposed in browser code.

This document captures everything needed to add Pinterest support later.

---

## 1. App Registration

1. Create / log into a Pinterest **business account**
2. Go to [developers.pinterest.com/apps/](https://developers.pinterest.com/apps/)
3. Accept Developer Terms of Service
4. Click **Connect app** → fill app information
5. Submit for review (reviewed each business day)
6. Once approved (Trial access): get **App ID** and **App Secret**
7. Configure at least 1 redirect URI (must match exactly during OAuth)

### Access Tiers
| Tier | Rate Limit | Notes |
|------|-----------|-------|
| Trial | 1,000 req/day | Automatic after approval |
| Standard | 100 req/sec/user | Requires additional review |

---

## 2. OAuth 2.0 Flow (Authorization Code)

**This MUST happen on a backend server.**

### Step 1: Redirect user to Pinterest
```
GET https://www.pinterest.com/oauth/
  ?client_id=YOUR_APP_ID
  &redirect_uri=https://yoursite.com/callback
  &response_type=code
  &scope=boards:read,pins:read
  &state=random_csrf_token
```

### Step 2: Pinterest redirects back with `code`
```
https://yoursite.com/callback?code=AUTH_CODE&state=random_csrf_token
```

### Step 3: Exchange code for token (SERVER-SIDE ONLY)
```
POST https://api.pinterest.com/v5/oauth/token
Authorization: Basic base64(APP_ID:APP_SECRET)
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code=AUTH_CODE
&redirect_uri=https://yoursite.com/callback
```

### Response
```json
{
  "access_token": "pina_...",
  "refresh_token": "pinr_...",
  "token_type": "bearer",
  "expires_in": 2592000,
  "refresh_token_expires_in": 31536000,
  "scope": "boards:read pins:read"
}
```

### Refresh Token (before expiration)
```
POST https://api.pinterest.com/v5/oauth/token
Authorization: Basic base64(APP_ID:APP_SECRET)
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&refresh_token=pinr_...
```

---

## 3. API Endpoints

**Base URL:** `https://api.pinterest.com/v5`

All requests require: `Authorization: Bearer ACCESS_TOKEN`

### List user's boards
```
GET /v5/boards
  ?page_size=25
  &bookmark=NEXT_PAGE_TOKEN
```

Response:
```json
{
  "bookmark": "...",
  "items": [
    {
      "id": "549755885175",
      "name": "Summer recipes",
      "description": "My favorite summer recipes",
      "privacy": "PUBLIC",
      "pin_count": 5,
      "media": {
        "image_cover_url": "https://i.pinimg.com/400x300/...",
        "pin_thumbnail_urls": ["https://i.pinimg.com/150x150/..."]
      }
    }
  ]
}
```

### List pins on a board
```
GET /v5/boards/{board_id}/pins
  ?page_size=25
  &bookmark=NEXT_PAGE_TOKEN
```

### Get a single pin
```
GET /v5/pins/{pin_id}
```

Response:
```json
{
  "id": "654321654321654321",
  "title": "Tree",
  "description": "Tree photo",
  "link": "https://example.com/",
  "board_id": "123456123456123456",
  "media": {
    "media_type": "image",
    "images": {
      "150x150": { "url": "https://i.pinimg.com/150x150/...", "width": 150, "height": 150 },
      "400x300": { "url": "https://i.pinimg.com/400x300/...", "width": 400, "height": 300 },
      "600x":    { "url": "https://i.pinimg.com/600x/...",    "width": 600 },
      "1200x":   { "url": "https://i.pinimg.com/1200x/...",   "width": 1200 }
    }
  }
}
```

---

## 4. Backend Architecture (Required)

```
Browser (netwrk frontend)
    │
    ├── GET /api/pinterest/auth     → redirects to Pinterest OAuth
    ├── GET /api/pinterest/callback → exchanges code for token, stores it
    ├── GET /api/pinterest/boards   → proxies to Pinterest API
    └── GET /api/pinterest/boards/:id/pins → proxies to Pinterest API
    │
Node.js / Express Server
    │
    └── Pinterest API (api.pinterest.com/v5)
```

### Skeleton server (Node.js + Express)
```javascript
// server.js — Pinterest OAuth proxy (future implementation)
const express = require("express");
const fetch   = require("node-fetch");
const app     = express();

const PINTEREST_APP_ID     = process.env.PINTEREST_APP_ID;
const PINTEREST_APP_SECRET = process.env.PINTEREST_APP_SECRET;
const REDIRECT_URI         = process.env.REDIRECT_URI;
const BASIC_AUTH           = Buffer.from(PINTEREST_APP_ID + ":" + PINTEREST_APP_SECRET).toString("base64");

app.get("/api/pinterest/auth", (req, res) => {
  const state = crypto.randomUUID();
  // Store state in session for CSRF validation
  const url = `https://www.pinterest.com/oauth/?client_id=${PINTEREST_APP_ID}&redirect_uri=${REDIRECT_URI}&response_type=code&scope=boards:read,pins:read&state=${state}`;
  res.redirect(url);
});

app.get("/api/pinterest/callback", async (req, res) => {
  const { code } = req.query;
  const tokenRes = await fetch("https://api.pinterest.com/v5/oauth/token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + BASIC_AUTH,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });
  const tokens = await tokenRes.json();
  // Store tokens securely (session, database, etc.)
  // Redirect back to frontend
  res.redirect("/?pinterest=connected");
});

app.get("/api/pinterest/boards", async (req, res) => {
  // Get stored token for this user
  const token = "..."; // retrieve from session/db
  const apiRes = await fetch("https://api.pinterest.com/v5/boards?page_size=100", {
    headers: { Authorization: "Bearer " + token },
  });
  res.json(await apiRes.json());
});

app.listen(3000);
```

---

## 5. Mapping Pinterest → netwrk data model

| Pinterest | netwrk |
|-----------|--------|
| Board `.id` | `board.pinterestBoardId` |
| Board `.name` | `board.name` |
| Board `.description` | `board.description` |
| Board `.media.image_cover_url` | (display as board thumbnail) |
| Pin `.id` | `pin.pinterestPinId` |
| Pin `.title` | `pin.title` |
| Pin `.media.images["600x"].url` | `pin.imageUrl` |
| Pin `.board_id` | maps to `pin.boardId` via board lookup |

---

## 6. Key Constraints

- **client_secret must never appear in frontend code**
- OAuth redirect URI must be HTTPS and match exactly what's registered
- Trial tier: 1,000 requests/day — sufficient for import but not real-time sync
- Tokens expire in 30 days; refresh tokens in 365 days
- App review can take 1+ business days
- CORS is not supported for direct browser → Pinterest API calls
