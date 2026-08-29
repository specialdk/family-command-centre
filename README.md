# Family Command Centre

A local-first source-code version of the Family Command Centre, ready to keep in Visual Studio / VS Code, publish to GitHub, and deploy to Railway.

## What is included

- Responsive family dashboard
- Family members
- Calendar / events
- Tasks with family allocation
- Chores
- Meals / recipe notes
- Shopping list
- Quick capture
- Optional browser speech-to-text quick capture
- PostgreSQL persistence through Prisma
- Simple password protection
- Railway configuration
- Seed/sample data
- Print-friendly dashboard styling

> This package is a clean local rebuild based on the Family Command Centre requirements. It is not a byte-for-byte export of the existing `chatgpt.site` source because that hosted source is not directly available from this chat.

## Project structure

```text
family-command-centre/
├─ apps/
│  ├─ server/
│  │  ├─ prisma/
│  │  │  ├─ schema.prisma
│  │  │  └─ seed.js
│  │  ├─ src/
│  │  │  └─ index.js
│  │  └─ package.json
│  └─ web/
│     ├─ src/
│     │  ├─ App.jsx
│     │  ├─ main.jsx
│     │  └─ styles.css
│     ├─ index.html
│     ├─ package.json
│     └─ vite.config.js
├─ .env.example
├─ .gitignore
├─ package.json
├─ railway.json
└─ README.md
```

## 1. Open locally in Visual Studio / VS Code

1. Extract this project somewhere such as:
   `C:\Projects\family-command-centre`
2. Open that folder in VS Code or Visual Studio.
3. Install Node.js 20 or later.
4. Install PostgreSQL locally, OR use a Railway PostgreSQL database while developing.
5. Copy `.env.example` to `.env`.
6. Fill in:
   - `DATABASE_URL`
   - `APP_PASSWORD`
   - `COOKIE_SECRET`

Install dependencies:

```bash
npm install
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
```

Start development mode:

```bash
npm run dev
```

Open:

```text
http://localhost:5173
```

The Vite development server proxies `/api` to the local API server.

## 2. Push to GitHub

From the project directory:

```bash
git init
git add .
git commit -m "Initial Family Command Centre"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/family-command-centre.git
git push -u origin main
```

Do not add your `.env` file to Git.

## 3. Deploy to Railway

### Create the database

1. Create a new Railway project.
2. Add a **PostgreSQL** service.
3. Add a new service from your GitHub repository.

### Set environment variables on the web service

Set:

```text
DATABASE_URL
APP_PASSWORD
COOKIE_SECRET
NODE_ENV=production
```

For `DATABASE_URL`, use the Railway PostgreSQL variable/reference.

For `COOKIE_SECRET`, use a long random value.

Railway will supply `PORT`.

### Deployment

The repository includes `railway.json`.

Build command:

```text
npm run railway:build
```

Start command:

```text
npm run railway:start
```

The start process automatically applies committed Prisma migrations before starting the web service.

### Generate a public URL

In the Railway web service:

**Settings → Networking → Generate Domain**

You can later connect your own domain.

## 4. Database changes

After changing `apps/server/prisma/schema.prisma` locally:

```bash
npm run prisma:migrate
```

Commit the generated `apps/server/prisma/migrations` folder to GitHub.

Railway then applies the migrations at deployment.

## 5. Security

The included password gate is suitable as a simple private family access layer, but for a more mature version consider Microsoft Entra ID / Google / Auth0 individual user logins.

Never put the following in source code:

- Microsoft API secrets
- OpenAI keys
- Google credentials
- Database passwords
- Railway tokens
- Email credentials

Put those in `.env` locally and Railway Variables in production.

## 6. Next integrations

The code is structured so these can be added later:

- Microsoft Outlook Calendar
- Microsoft To Do
- Google Calendar
- SharePoint family document library
- Family member logins
- Push notifications
- AI voice capture
- Recipe photo import
- Automated shopping-list generation
- Chore rotation
- ADHD-friendly reminder workflows

## 7. Backups

Railway is the hosted runtime, but GitHub should be your source-code source of truth.

For family data, also enable a sensible PostgreSQL backup strategy before relying on the service as the only copy of important information.
