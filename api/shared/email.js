// api/shared/email.js
// Sends email via Microsoft Graph API using the hughes-shuttle-sp app registration
// Sends from noreply@equitytransport.com.au

const fetch = require('node-fetch');

const FROM_ADDRESS = 'Shuttlebus@hughes.com.au';
const TENANT_ID    = process.env.SHAREPOINT_TENANT_ID;
const CLIENT_ID    = process.env.SHAREPOINT_CLIENT_ID;

let _tokenCache = { token: null, expiry: 0 };

async function getGraphToken() {
  if (_tokenCache.token && Date.now() < _tokenCache.expiry - 60000) return _tokenCache.token;
  const { getSecret } = require('./keyVault');
  const clientSecret  = await getSecret('sharepoint-client-secret');
  const url  = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     CLIENT_ID,
    client_secret: clientSecret,
    scope:         'https://graph.microsoft.com/.default',
  });
  const res  = await fetch(url, { method: 'POST', body });
  const data = await res.json();
  if (!data.access_token) throw new Error('Failed to get Graph token: ' + JSON.stringify(data));
  _tokenCache = { token: data.access_token, expiry: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

async function sendEmail(to, subject, htmlBody) {
  const token = await getGraphToken();
  const url   = `https://graph.microsoft.com/v1.0/users/${FROM_ADDRESS}/sendMail`;
  const res   = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        subject,
        body:         { contentType: 'HTML', content: htmlBody },
        toRecipients: [{ emailAddress: { address: to } }],
        from:         { emailAddress: { address: FROM_ADDRESS } },
      },
      saveToSentItems: false,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Email send failed (${res.status}): ${text}`);
  }
  return true;
}

// ── Email templates ──

function otpTemplate(name, otp) {
  return `
  <div style="font-family:Arial,sans-serif;background:#F8F6F1;padding:40px 20px;max-width:600px;margin:0 auto;">
    <div style="background:#1A2340;padding:20px 28px;border-radius:10px 10px 0 0;display:flex;align-items:center;gap:12px;">
      <div style="border:1.5px solid #C9A84C;border-radius:6px;padding:6px 10px;">
        <span style="color:#C9A84C;font-size:18px;font-weight:700;">HS</span>
      </div>
      <span style="color:#fff;font-size:17px;font-weight:600;letter-spacing:0.03em;">Hughes Shuttle</span>
    </div>
    <div style="background:#fff;padding:32px 28px;border-radius:0 0 10px 10px;border:0.5px solid rgba(26,35,64,0.1);">
      <h3 style="color:#1A2340;margin:0 0 8px;font-size:18px;">Verify your email</h3>
      <p style="color:#6B7280;font-size:14px;margin:0 0 24px;line-height:1.6;">Hi ${name || 'there'},<br>Enter this code to activate your Hughes Shuttle account.</p>
      <div style="text-align:center;margin:28px 0;">
        <div style="display:inline-block;background:#F5EDD6;border:2px solid #C9A84C;border-radius:10px;padding:18px 40px;">
          <span style="font-size:34px;font-weight:900;letter-spacing:0.3em;color:#1A2340;">${otp}</span>
        </div>
      </div>
      <p style="color:#6B7280;font-size:13px;text-align:center;margin:0 0 24px;">This code expires in <strong style="color:#1A2340;">10 minutes</strong>. Do not share it with anyone.</p>
      <hr style="border:none;border-top:0.5px solid rgba(26,35,64,0.1);margin:0 0 16px;">
      <p style="color:#6B7280;font-size:12px;text-align:center;margin:0;">Hughes Shuttle &mdash; <a href="mailto:info@hughes.com.au" style="color:#C9A84C;">info@hughes.com.au</a></p>
    </div>
  </div>`;
}

function welcomeTemplate(name, email, tempPassword) {
  return `
  <div style="font-family:Arial,sans-serif;background:#F8F6F1;padding:40px 20px;max-width:600px;margin:0 auto;">
    <div style="background:#1A2340;padding:20px 28px;border-radius:10px 10px 0 0;">
      <span style="color:#fff;font-size:17px;font-weight:600;">Hughes Shuttle</span>
    </div>
    <div style="background:#fff;padding:32px 28px;border-radius:0 0 10px 10px;border:0.5px solid rgba(26,35,64,0.1);">
      <h3 style="color:#1A2340;margin:0 0 8px;">Welcome, ${name}!</h3>
      <p style="color:#6B7280;font-size:14px;margin:0 0 8px;line-height:1.6;">Your Hughes Shuttle account has been created. Sign in with the details below.</p>
      <p style="color:#6B7280;font-size:13px;margin:0 0 20px;">Please change your password after your first login.</p>
      <div style="background:#F8F6F1;border:0.5px solid rgba(26,35,64,0.1);border-radius:8px;padding:16px 20px;margin-bottom:24px;">
        <p style="margin:0 0 8px;font-size:13px;color:#1A2340;"><strong>Email:</strong> ${email}</p>
        <p style="margin:0;font-size:13px;color:#1A2340;"><strong>Temporary password:</strong> <span style="font-family:monospace;background:#F5EDD6;padding:2px 8px;border-radius:4px;">${tempPassword}</span></p>
      </div>
      <hr style="border:none;border-top:0.5px solid rgba(26,35,64,0.1);margin:0 0 16px;">
      <p style="color:#6B7280;font-size:12px;text-align:center;margin:0;">Hughes Shuttle &mdash; <a href="mailto:info@hughes.com.au" style="color:#C9A84C;">info@hughes.com.au</a></p>
    </div>
  </div>`;
}

function bookingConfirmTemplate(name, ref, serviceNum, stopName, depTime, travelDate) {
  return `
  <div style="font-family:Arial,sans-serif;background:#F8F6F1;padding:40px 20px;max-width:600px;margin:0 auto;">
    <div style="background:#1A2340;padding:20px 28px;border-radius:10px 10px 0 0;">
      <span style="color:#fff;font-size:17px;font-weight:600;">Hughes Shuttle</span>
    </div>
    <div style="background:#fff;padding:32px 28px;border-radius:0 0 10px 10px;border:0.5px solid rgba(26,35,64,0.1);">
      <div style="text-align:center;margin-bottom:24px;">
        <div style="width:48px;height:48px;background:#EAF3DE;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;margin-bottom:12px;">
          <span style="font-size:22px;">✓</span>
        </div>
        <h3 style="color:#1A2340;margin:0 0 4px;">Booking confirmed!</h3>
        <p style="color:#6B7280;font-size:13px;margin:0;">Hi ${name}, your seat is reserved.</p>
      </div>
      <div style="background:#F8F6F1;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:0.5px solid rgba(26,35,64,0.08);font-size:13px;"><span style="color:#6B7280;">Reference</span><strong style="color:#1A2340;font-family:monospace;">${ref}</strong></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:0.5px solid rgba(26,35,64,0.08);font-size:13px;"><span style="color:#6B7280;">Service</span><span style="color:#1A2340;">Service No.${serviceNum}</span></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:0.5px solid rgba(26,35,64,0.08);font-size:13px;"><span style="color:#6B7280;">Boarding at</span><span style="color:#1A2340;">${stopName}</span></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:0.5px solid rgba(26,35,64,0.08);font-size:13px;"><span style="color:#6B7280;">Departure</span><span style="color:#1A2340;">${depTime}</span></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;"><span style="color:#6B7280;">Date</span><span style="color:#1A2340;">${travelDate}</span></div>
      </div>
      <hr style="border:none;border-top:0.5px solid rgba(26,35,64,0.1);margin:0 0 16px;">
      <p style="color:#6B7280;font-size:12px;text-align:center;margin:0;">Hughes Shuttle &mdash; <a href="mailto:info@hughes.com.au" style="color:#C9A84C;">info@hughes.com.au</a></p>
    </div>
  </div>`;
}

module.exports = { sendEmail, otpTemplate, welcomeTemplate, bookingConfirmTemplate };
