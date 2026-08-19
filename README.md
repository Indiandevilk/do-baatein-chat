# Do Baatein

Private two-person realtime chat with username/password login.

## Run locally

1. Install Node.js LTS from https://nodejs.org/
2. In this folder run:

```powershell
npm install
npm start
```

3. Open `http://localhost:3000` in two browser windows or devices on the same network.

## Make it available on the internet

1. Create a GitHub repository and upload this complete folder.
2. Open https://render.com and sign in with GitHub.
3. Choose **New +** -> **Blueprint**, select the repository, and deploy.
4. Render will create a public `onrender.com` URL. Share that URL with the second person.

The app stores users and messages in `data/`. Render's free service can lose this local data when it is redeployed or restarted, so add a persistent disk or a database before using it for important conversations. Socket.IO realtime chat works on Render.

Login sessions use a long-lived signed cookie, so a normal server update does not ask users to log in again. Only the explicit **Logout** button clears a login session. Messages stay saved when either user logs out or closes the website.
