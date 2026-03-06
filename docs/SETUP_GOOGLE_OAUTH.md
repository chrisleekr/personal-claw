# Google OAuth Setup Guide

## Prerequisites

- A Google account with access to [Google Cloud Console](https://console.cloud.google.com/)
- PersonalClaw frontend running (default: `http://localhost:3000`)

## Step-by-Step Setup

### 1. Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click the project dropdown at the top and select **New Project**
3. Name it `PersonalClaw` (or your preferred name)
4. Click **Create**

### 2. Enable Required APIs

1. Navigate to **APIs & Services** > **Library**
2. Search for and enable:
   - **Google Identity Services**
   - **Google+ API** (may be listed as "Google People API")

### 3. Configure OAuth Consent Screen

1. Go to **APIs & Services** > **OAuth consent screen**
2. Select **External** user type (or Internal if using Google Workspace)
3. Fill in required fields:
   - **App name**: PersonalClaw
   - **User support email**: your email
   - **Developer contact information**: your email
4. Click **Save and Continue**
5. Under **Scopes**, add:
   - `email`
   - `profile`
   - `openid`
6. Click **Save and Continue** through remaining steps

### 4. Create OAuth 2.0 Credentials

1. Go to **APIs & Services** > **Credentials**
2. Click **+ Create Credentials** > **OAuth client ID**
3. Select **Web application**
4. Set **Name**: `PersonalClaw Web`
5. Add **Authorized JavaScript origins**:
   - `http://localhost:3000`
6. Add **Authorized redirect URIs**:
   - `http://localhost:3000/api/auth/callback/google`
7. Click **Create**
8. Copy the **Client ID** and **Client Secret**

### 5. Configure Environment Variables

Add these to your `.env` file at the project root:

```env
GOOGLE_CLIENT_ID=your-client-id-here.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret-here
AUTH_SECRET=<run: openssl rand -base64 32>
AUTH_URL=http://localhost:3000
```

Generate `AUTH_SECRET`:

```bash
openssl rand -base64 32
```

### 6. Production Configuration

For production deployment, add your production domain:

1. In Google Cloud Console > Credentials > Edit your OAuth client
2. Add to **Authorized JavaScript origins**: `https://yourdomain.com`
3. Add to **Authorized redirect URIs**: `https://yourdomain.com/api/auth/callback/google`
4. Update `.env`:
   ```env
   AUTH_URL=https://yourdomain.com
   ```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "redirect_uri_mismatch" | Ensure the redirect URI in Google Cloud exactly matches `AUTH_URL + /api/auth/callback/google` |
| "access_denied" | Check that your email is added as a test user if the app is in "Testing" publishing status |
| "invalid_client" | Verify GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are correct |
| Login redirects to blank page | Ensure AUTH_SECRET is set and AUTH_URL matches the running app URL |

## References

- [Auth.js Google Provider](https://authjs.dev/getting-started/providers/google)
- [Google OAuth 2.0 Documentation](https://developers.google.com/identity/protocols/oauth2)
