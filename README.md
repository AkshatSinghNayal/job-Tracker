# JobTracker 🐱

A fast, tactile personal job application tracker and career operating system built with **FastAPI**, **MongoDB (Motor + GridFS)**, and **JWT auth**. 

Featuring an interactive **Kanban pipeline board**, **client-side JD tech skills extractor**, **GridFS resume presets**, **1-click CSV/JSON export**, and **strict multi-user privacy isolation**.

Served completely from one process with vanilla ES modules and **zero frontend build steps**.

---

## Highlights & Features

### 📋 Module 1: Tactile Kanban Pipeline Board
- Switch seamlessly between **Card Grid** view and **Pipeline Kanban Board**.
- Drag & drop applications across 5 stages: `Saved`, `Applied`, `Interviewing`, `Offer`, and `Rejected`.
- Real-time column counters and stage badges with tactile Neo-Brutalist drop shadows.

### ⚡ Module 2: Real-time JD Tech Skills Extractor
- Analyzes Job Descriptions on the client side for 60+ programming languages, frameworks, cloud platforms, and dev tools (Python, React, TypeScript, Docker, Kubernetes, AWS, Go, etc.).
- Interactive skill chips in the detail view: clicking any detected chip smoothly scrolls to and highlights the keyword inside the Job Description.

### 📁 Module 5: GridFS Resume Preset Selector
- Store resumes securely in **MongoDB GridFS** with SHA-256 deduplication and AES-128 Fernet encryption.
- **Upload once, reuse anywhere**: Choose from previously uploaded resumes when submitting a new application without re-uploading the file.
- In-browser native PDF viewer with range request support and streaming download.

### 🔒 Multi-User Privacy & Isolation
- **Admin Control**: Built-in administrator account with access to legacy seed data and system controls.
- **Private Registration**: Friends can register their own accounts (`POST /api/auth/register`).
- **Strict Data Scoping**: Every application and resume PDF is isolated strictly to the user's `owner_id`. No user can ever view, reuse, or download another user's resumes or applications.

### 💾 Module 3: 1-Click Export
- Export your entire application history to **CSV** or structured **JSON** in one click from the applications view.

### 🎨 Educational Platform / Neo-Brutalist Design System
- Inspired by LearnHub / Neo-Brutalist design tokens:
  - Google Font **Plus Jakarta Sans** with clean letter-spacing.
  - Warm cream paper background (`#faf8f5`) with tactile dot-matrix texture.
  - Deep charcoal dark mode (`#111318`) with high-contrast electric emerald accents (`#22c55e`).
  - Solid 2px ink borders with zero-blur tactile drop shadows (`3px 3px 0 #18181b`).
  - Custom vector Ginger Cat mascot logo and favicon.

---

## Tech Stack

| Layer | Technologies |
| --- | --- |
| **Backend** | Python 3.11+, FastAPI, Uvicorn, Pydantic v2, Motor (Async MongoDB), PyJWT, Argon2-cffi, Cryptography (Fernet) |
| **Database & Storage** | MongoDB 7+ / MongoDB Atlas, GridFS bucket (`resumes`) |
| **Frontend** | Vanilla JavaScript (ES modules), Semantic HTML5, CSS Variables Design System (zero node/npm build step) |
| **Deployment** | Vercel Serverless (`api/index.py` + `vercel.json`), Docker Compose, Render |

---

## Cloud Deployment Guide

### Option A: Vercel + MongoDB Atlas (100% Free Serverless)

1. **Setup MongoDB Atlas**:
   - Create a free **M0 cluster** at [mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas).
   - Under **Security → Database Access**, create a user (e.g., `jobtracker_user`).
   - Under **Security → Network Access**, add `0.0.0.0/0` (Allow Access from Anywhere) so Vercel's serverless lambdas can connect.
   - Copy your connection string: `mongodb+srv://<user>:<password>@cluster0.abcde.mongodb.net/?retryWrites=true&w=majority`.

2. **Deploy to Vercel**:
   - Push your repository to GitHub.
   - Import the repo in [vercel.com/new](https://vercel.com/new) (Framework preset: **Other**).
   - Configure Environment Variables in Vercel:

| Environment Variable | Recommended Value | Description |
| --- | --- | --- |
| `APP_SECRET_KEY` | *(generate with `scripts/generate_keys.py`)* | 64+ char secret for JWT signing |
| `FERNET_KEY` | *(generate with `scripts/generate_keys.py`)* | 32-byte urlsafe Fernet key |
| `APP_DB_URI` | `mongodb+srv://...` | MongoDB Atlas connection string |
| `APP_DB_NAME` | `jobtracker` | Database name |
| `ADMIN_USERNAME` | `admin` | Your admin username |
| `ADMIN_PASSWORD` | *(strong private password)* | Your admin password |
| `COOKIE_SECURE` | `true` | Enforces HTTPS-only cookies |
| `MAX_UPLOAD_MB` | `4` | Vercel serverless request body limit is 4.5 MB |
| `ALLOWED_ORIGINS` | `https://your-domain.vercel.app` | CORS protection |

3. **Deploy**:
   - Click **Deploy**. Vercel will build and serve your app.
   - Visit your Vercel URL and log in! Friends can click **"Create Private Account"** to get their own isolated workspaces on the same deployment.

---

### Option B: Docker Compose (Self-Hosted)

For full data sovereignty on a VPS (DigitalOcean, Hetzner, AWS EC2):

```bash
git clone git@github.com:AkshatSinghNayal/job-Tracker.git
cd job-Tracker

cp .env.example .env
python3 scripts/generate_keys.py   # paste output into .env
nano .env                          # set ADMIN_PASSWORD

docker compose up -d
```

Access the app at `http://localhost:8000`.

---

## Local Development Setup

```bash
# 1. Clone repository
git clone git@github.com:AkshatSinghNayal/job-Tracker.git
cd job-Tracker

# 2. Setup Python virtual environment
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 3. Configure environment
cp .env.example .env
python scripts/generate_keys.py    # paste generated keys into .env
# Edit .env and set your ADMIN_PASSWORD

# 4. Start local server
make dev
# or: uvicorn app.main:app --reload --port 8000
```

Open `http://localhost:8000` in your browser.

---

## Make Commands

| Command | Description |
| --- | --- |
| `make dev` | Start development server with auto-reload |
| `make test` | Run full pytest suite (27/27 tests) |
| `make lint` | Run Ruff linter across `app/`, `scripts/`, `tests/` |
| `make keys` | Generate cryptographically secure `APP_SECRET_KEY` and `FERNET_KEY` |
| `make seed` | Insert sample applications with generated PDF resumes |

---

## API Reference

All protected endpoints require an `Authorization: Bearer <access_token>` header.

### Authentication & Accounts
| Method | Endpoint | Description |
| --- | --- | --- |
| `POST` | `/api/auth/register` | Register a new user with private workspace scoping |
| `POST` | `/api/auth/login` | Authenticate and obtain JWT access token + refresh cookie |
| `POST` | `/api/auth/refresh` | Rotate refresh token and issue new access token |
| `POST` | `/api/auth/logout` | Revoke session and clear cookies |
| `POST` | `/api/auth/change-password` | Update account password |
| `GET` | `/api/auth/me` | Fetch active user identity |
| `GET` | `/api/auth/system-info` | Real-time database latency and deployment diagnostics |

### Applications & Resumes
| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/applications` | List applications (supports `search`, `status_filter`, `sort`) |
| `POST` | `/api/applications` | Create application (multipart with PDF or `resume_preset_id`) |
| `GET` | `/api/applications/{id}` | Retrieve full application details and JD text |
| `PATCH` | `/api/applications/{id}` | Update application details or stage |
| `DELETE` | `/api/applications/{id}` | Delete application and clean up associated GridFS PDF |
| `GET` | `/api/applications/{id}/resume` | Stream resume PDF (inline or attachment) |
| `GET` | `/api/applications/resumes` | List distinct resume presets for active user |
| `GET` | `/api/applications/export/csv` | Download complete applications history as CSV |
| `GET` | `/api/applications/export/json` | Download complete applications history as JSON |

---

## Security Model

- **Zero Client Credential Leakage**: Admin credentials and default passwords are never exposed in client bundles or public endpoints.
- **Argon2id Password Hashing**: Passwords are securely hashed with argon2id.
- **JWT Protection**: Short-lived access tokens (15 minutes) paired with single-use rotating refresh tokens stored in HttpOnly, SameSite cookies.
- **GridFS Isolation**: Resumes are streamed only through authenticated endpoints verified against the user's `owner_id`.
- **Content Security Policy (CSP)**: Strict headers with `nosniff`, `no-store` on resume PDFs, and XSS mitigation.

---

## License

MIT License. Built with ❤️ for organized job hunting.
