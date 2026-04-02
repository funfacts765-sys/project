import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  // FIXED: Vercel/Render will provide the port automatically
  const PORT = process.env.PORT || 3000;

  app.use(express.json());
  app.use(cookieParser());

  // --- GITHUB OAUTH ROUTES (ALL FEATURES PRESERVED) ---
  app.get('/api/auth/github/url', (req, res) => {
    const clientId = process.env.GITHUB_CLIENT_ID;
    if (!clientId) return res.status(500).json({ error: 'GITHUB_CLIENT_ID not configured' });

    const redirectUri = `${req.protocol}://${req.get('host')}/api/auth/github/callback`;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: 'read:user user:email',
    });

    res.json({ url: `https://github.com/login/oauth/authorize?${params}` });
  });

  app.get('/api/auth/github/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).send('Missing code');

    try {
      const tokenResponse = await axios.post('https://github.com/login/oauth/access_token', {
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
      }, { headers: { Accept: 'application/json' } });

      const accessToken = tokenResponse.data.access_token;
      const userResponse = await axios.get('https://api.github.com/user', {
        headers: { Authorization: `token ${accessToken}` },
      });

      const githubUser = {
        id: userResponse.data.id,
        login: userResponse.data.login,
        name: userResponse.data.name,
        avatar_url: userResponse.data.avatar_url,
      };

      // FIXED: Production-ready cookies
      res.cookie('github_user', JSON.stringify(githubUser), {
        httpOnly: true,
        secure: true, 
        sameSite: 'none',
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });

      res.send(`<html><body><script>
        if (window.opener) {
          window.opener.postMessage({ type: 'GITHUB_AUTH_SUCCESS', user: ${JSON.stringify(githubUser)} }, '*');
          window.close();
        } else { window.location.href = '/'; }
      </script></body></html>`);
    } catch (error: any) {
      res.status(500).send('Authentication failed');
    }
  });

  app.get('/api/user/github', (req, res) => {
    const githubUser = req.cookies.github_user;
    githubUser ? res.json(JSON.parse(githubUser)) : res.status(401).json({ error: 'Not connected' });
  });

  app.post('/api/auth/github/logout', (req, res) => {
    res.clearCookie('github_user', { httpOnly: true, secure: true, sameSite: 'none' });
    res.json({ success: true });
  });

  // --- VITE / STATIC SERVING ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  app.listen(Number(PORT), '0.0.0.0', () => console.log(`Server live on ${PORT}`));
}

startServer();
// Export for Vercel
export default startServer;