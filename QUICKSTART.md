# ColdStart Quick Start Guide

Get ColdStart running in 5 minutes using Docker.

## Prerequisites

- Docker Desktop installed (Windows/Mac) or Docker Engine (Linux)
- Google Gemini API key ([Get one here](https://ai.google.dev/))

## 1️⃣ Clone & Configure

```bash
# Clone the repository
git clone https://github.com/yourusername/ColdStart.git
cd ColdStart

# Create environment file
cp .env.example .env

# Edit .env and add your Gemini API key
# Windows:
notepad .env

# Mac/Linux:
nano .env
```

Update this line in `.env`:
```env
GEMINI_API_KEY=your_actual_api_key_here
```

## 2️⃣ Start Everything

```bash
# Start both Helix DB and the web app
docker-compose up
```

Wait for:
```
coldstart-helix  | ✓ Helix DB started on port 6969
coldstart-web    | ✓ Ready on http://localhost:3000
```

## 3️⃣ Access the App

Open your browser to: **http://localhost:3000**

You should see the resume upload interface.

## 4️⃣ Test Resume Upload

1. Drag and drop a PDF or DOCX resume
2. Click "Upload Resume"
3. Wait for AI processing
4. View extracted candidate information

## 5️⃣ (Optional) Load Sample Data

```bash
# In a new terminal, run the CSV ingestion script
docker exec -it coldstart-web npm run ingest
```

This loads Y Combinator startup data into Helix DB.

---

## Common Issues

### "Error: Cannot connect to Helix"

**Solution**: Wait 30 seconds for Helix to fully start, then refresh.

### "Port 3000 already in use"

**Solution**: Change the port in `docker-compose.yml`:
```yaml
web:
  ports:
    - "3001:3000"  # Use port 3001 instead
```

### "GEMINI_API_KEY not set"

**Solution**: Make sure you created `.env` (not `.env.local`) with your API key.

---

## Development Mode (Hot Reload)

For active development with code changes auto-reloading:

```bash
# Stop the production containers
docker-compose down

# Start in development mode
docker-compose --profile dev up web-dev
```

Now edit files in `app/`, `lib/`, or `db/` and see changes instantly.

---

## Stopping the App

```bash
# Stop containers but keep data
docker-compose down

# Stop and remove all data (CAUTION)
docker-compose down -v
```

---

## Next Steps

- **Full deployment guide**: See [DEPLOYMENT.md](DEPLOYMENT.md)
- **Architecture overview**: See [README.md](README.md)
- **Troubleshooting**: See [DEPLOYMENT.md#troubleshooting](DEPLOYMENT.md#troubleshooting)

---

## Quick Reference

| Command | Purpose |
|---------|---------|
| `docker-compose up` | Start production app |
| `docker-compose --profile dev up web-dev` | Start dev mode |
| `docker-compose down` | Stop app |
| `docker-compose logs -f` | View live logs |
| `docker-compose restart helix` | Restart database |
| `docker exec -it coldstart-web npm run ingest` | Load sample data |
| `docker stats` | View resource usage |
