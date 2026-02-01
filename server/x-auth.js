// server/x-auth.js
// X (Twitter) OAuth 2.0 Authentication for Lobster creators

import crypto from 'crypto';

// Store sessions and PKCE codes (in production, use Redis or similar)
const sessions = new Map();
const pkceStore = new Map();

// X OAuth 2.0 Configuration
const X_AUTH_URL = 'https://twitter.com/i/oauth2/authorize';
const X_TOKEN_URL = 'https://api.twitter.com/2/oauth2/token';
const X_USER_URL = 'https://api.twitter.com/2/users/me';

// Generate PKCE code verifier and challenge
function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto
    .createHash('sha256')
    .update(verifier)
    .digest('base64url');
  return { verifier, challenge };
}

// Generate state for CSRF protection
function generateState() {
  return crypto.randomBytes(16).toString('hex');
}

// Initialize X auth routes
export function setupXAuth(app) {
  const CLIENT_ID = process.env.X_CLIENT_ID;
  const CLIENT_SECRET = process.env.X_CLIENT_SECRET;
  const REDIRECT_URI = process.env.X_REDIRECT_URI || 'http://localhost:3001/auth/x/callback';

  if (!CLIENT_ID) {
    console.warn('⚠️ X_CLIENT_ID not set - X OAuth disabled');
    return;
  }

  console.log('🐦 X OAuth enabled');

  // Start OAuth flow - redirects user to X
  app.get('/auth/x/login', (req, res) => {
    const { agentId } = req.query;
    
    if (!agentId) {
      return res.status(400).json({ error: 'agentId required' });
    }

    const state = generateState();
    const { verifier, challenge } = generatePKCE();
    
    // Store PKCE verifier and agentId for callback
    pkceStore.set(state, { 
      verifier, 
      agentId,
      createdAt: Date.now() 
    });

    // Clean up old PKCE entries (older than 10 minutes)
    for (const [key, value] of pkceStore.entries()) {
      if (Date.now() - value.createdAt > 600000) {
        pkceStore.delete(key);
      }
    }

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: 'tweet.read users.read offline.access',
      state: state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });

    res.redirect(`${X_AUTH_URL}?${params.toString()}`);
  });

  // OAuth callback - exchange code for tokens
  app.get('/auth/x/callback', async (req, res) => {
    const { code, state, error } = req.query;

    const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
    
    if (error) {
      return res.redirect(`${FRONTEND_URL}/?auth_error=${encodeURIComponent(error)}`);
    }

    if (!code || !state) {
      return res.redirect(`${FRONTEND_URL}/?auth_error=missing_params`);
    }

    const pkceData = pkceStore.get(state);
    if (!pkceData) {
      return res.redirect(`${FRONTEND_URL}/?auth_error=invalid_state`);
    }

    pkceStore.delete(state);

    try {
      // Exchange code for tokens
      const tokenResponse = await fetch(X_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
        },
        body: new URLSearchParams({
          code,
          grant_type: 'authorization_code',
          redirect_uri: REDIRECT_URI,
          code_verifier: pkceData.verifier,
        }),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error('Token exchange failed:', errorText);
        return res.redirect(`${FRONTEND_URL}/?auth_error=token_exchange_failed`);
      }

      const tokens = await tokenResponse.json();

      // Get user info from X
      const userResponse = await fetch(X_USER_URL, {
        headers: {
          'Authorization': `Bearer ${tokens.access_token}`,
        },
      });

      if (!userResponse.ok) {
        return res.redirect(`${FRONTEND_URL}/?auth_error=user_fetch_failed`);
      }

      const userData = await userResponse.json();
      const xUser = userData.data;

      // Create session
      const sessionId = crypto.randomBytes(32).toString('hex');
      sessions.set(sessionId, {
        xId: xUser.id,
        xUsername: xUser.username,
        xName: xUser.name,
        agentId: pkceData.agentId,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        createdAt: Date.now(),
      });

      console.log(`✅ X auth success: @${xUser.username} for agent ${pkceData.agentId}`);

      // Redirect back with session cookie
      res.cookie('lobster_session', sessionId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      });

      res.redirect(`${FRONTEND_URL}/create-agent?auth_success=true`);
    } catch (err) {
      console.error('X auth error:', err);
      res.redirect(`${FRONTEND_URL}/?auth_error=server_error`);
    }
  });

  // Get current session
  app.get('/auth/x/session', (req, res) => {
    const sessionId = req.cookies?.lobster_session;
    
    if (!sessionId) {
      return res.json({ authenticated: false });
    }

    const session = sessions.get(sessionId);
    if (!session) {
      return res.json({ authenticated: false });
    }

    res.json({
      authenticated: true,
      xUsername: session.xUsername,
      xName: session.xName,
      agentId: session.agentId,
    });
  });

  // Logout
  app.post('/auth/x/logout', (req, res) => {
    const sessionId = req.cookies?.lobster_session;
    
    if (sessionId) {
      sessions.delete(sessionId);
    }

    res.clearCookie('lobster_session');
    res.json({ ok: true });
  });

  // Link X account to agent (called after auth)
  app.post('/api/agents/:name/link-x', async (req, res) => {
    const sessionId = req.cookies?.lobster_session;
    
    if (!sessionId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const session = sessions.get(sessionId);
    if (!session) {
      return res.status(401).json({ error: 'Session expired' });
    }

    const { name } = req.params;

    // Verify the session is for this agent
    if (session.agentId !== name) {
      return res.status(403).json({ error: 'Session not valid for this agent' });
    }

    try {
      // Import prisma dynamically to avoid circular deps
      const { updateAgent } = await import('./db.js');
      
      await updateAgent(name, {
        creatorName: `@${session.xUsername}`,
      });

      console.log(`🔗 Linked @${session.xUsername} as creator of ${name}`);

      res.json({ 
        ok: true, 
        creatorName: `@${session.xUsername}` 
      });
    } catch (err) {
      console.error('Failed to link X account:', err);
      res.status(500).json({ error: 'Failed to link account' });
    }
  });
}

// Get session for socket authentication
export function getSessionByUsername(xUsername) {
  for (const session of sessions.values()) {
    if (session.xUsername === xUsername.replace('@', '')) {
      return session;
    }
  }
  return null;
}

// Verify if a username is the creator of an agent
export function isCreatorOfAgent(xUsername, creatorName) {
  if (!xUsername || !creatorName) return false;
  const normalizedInput = xUsername.toLowerCase().replace('@', '');
  const normalizedCreator = creatorName.toLowerCase().replace('@', '');
  return normalizedInput === normalizedCreator;
}

export { sessions };
