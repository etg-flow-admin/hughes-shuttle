// api/shared/email.js
// Sends email via Microsoft Graph API using Shuttlebus@hughes.com.au shared mailbox
// All templates use table-based layout for maximum email client compatibility

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
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
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

// ── Shared header/footer using tables ──
function emailHeader() {
  return `
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#1A2340;">
    <tr>
      <td style="padding:20px 28px;">
        <table cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="border:1.5px solid #C9A84C;border-radius:6px;padding:5px 10px;line-height:1;">
              <span style="color:#C9A84C;font-size:16px;font-weight:700;font-family:Arial,sans-serif;">HS</span>
            </td>
            <td style="padding-left:12px;">
              <span style="color:#ffffff;font-size:17px;font-weight:600;font-family:Arial,sans-serif;letter-spacing:0.03em;">Hughes Shuttle</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>`;
}

function emailFooter() {
  return `
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #E5E7EB;margin-top:8px;">
    <tr>
      <td style="padding:16px 28px;text-align:center;">
        <span style="color:#9CA3AF;font-size:12px;font-family:Arial,sans-serif;">
          Hughes Shuttle &mdash; <a href="mailto:info@hughes.com.au" style="color:#C9A84C;text-decoration:none;">info@hughes.com.au</a>
        </span>
      </td>
    </tr>
  </table>`;
}

function emailWrapper(content) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#F8F6F1;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F8F6F1;">
    <tr>
      <td align="center" style="padding:40px 20px;">
        <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #E5E7EB;">
          <tr><td>${emailHeader()}</td></tr>
          <tr><td style="padding:32px 28px;">${content}</td></tr>
          <tr><td>${emailFooter()}</td></tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── OTP verification email ──
function otpTemplate(name, otp) {
  const content = `
    <p style="font-family:Arial,sans-serif;font-size:20px;font-weight:700;color:#1A2340;margin:0 0 8px;">Verify your email</p>
    <p style="font-family:Arial,sans-serif;font-size:14px;color:#6B7280;margin:0 0 28px;line-height:1.6;">
      Hi ${name || 'there'},<br>
      Enter this code to activate your Hughes Shuttle account.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td align="center" style="padding:8px 0 28px;">
          <table cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="background-color:#F5EDD6;border:2px solid #C9A84C;border-radius:10px;padding:18px 48px;text-align:center;">
                <span style="font-family:'Courier New',monospace;font-size:36px;font-weight:700;color:#1A2340;letter-spacing:10px;">${otp}</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
    <p style="font-family:Arial,sans-serif;font-size:13px;color:#6B7280;text-align:center;margin:0;">
      This code expires in <strong style="color:#1A2340;">10 minutes</strong>. Do not share it with anyone.
    </p>`;
  return emailWrapper(content);
}

// ── Welcome / admin-created account email ──
function welcomeTemplate(name, email, tempPassword) {
  const content = `
    <p style="font-family:Arial,sans-serif;font-size:20px;font-weight:700;color:#1A2340;margin:0 0 8px;">Welcome, ${name}!</p>
    <p style="font-family:Arial,sans-serif;font-size:14px;color:#6B7280;margin:0 0 6px;line-height:1.6;">Your Hughes Shuttle account has been created. Sign in with the details below.</p>
    <p style="font-family:Arial,sans-serif;font-size:13px;color:#6B7280;margin:0 0 24px;">Please change your password after your first login.</p>
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F8F6F1;border-radius:8px;border:1px solid #E5E7EB;margin-bottom:8px;">
      <tr>
        <td style="padding:16px 20px;">
          <p style="font-family:Arial,sans-serif;font-size:13px;color:#1A2340;margin:0 0 8px;"><strong>Email:</strong> ${email}</p>
          <p style="font-family:Arial,sans-serif;font-size:13px;color:#1A2340;margin:0;">
            <strong>Temporary password:</strong>&nbsp;
            <span style="font-family:'Courier New',monospace;background-color:#F5EDD6;padding:2px 8px;border-radius:4px;">${tempPassword}</span>
          </p>
        </td>
      </tr>
    </table>`;
  return emailWrapper(content);
}

// ── Booking confirmation email ──
function bookingConfirmTemplate(name, ref, serviceNum, stopName, depTime, travelDate) {
  const dateFormatted = travelDate.split('-').reverse().join('/');
  const rows = [
    ['Reference',   `<strong style="font-family:'Courier New',monospace;">${ref}</strong>`],
    ['Service',     `Service No.${serviceNum}`],
    ['Boarding at', stopName],
    ['Departure',   depTime],
    ['Date',        dateFormatted],
  ];
  const tableRows = rows.map(([label, value], i) => `
    <tr style="background-color:${i % 2 === 0 ? '#ffffff' : '#F8F6F1'};">
      <td style="font-family:Arial,sans-serif;font-size:13px;color:#6B7280;padding:10px 16px;width:40%;">${label}</td>
      <td style="font-family:Arial,sans-serif;font-size:13px;color:#1A2340;padding:10px 16px;">${value}</td>
    </tr>`).join('');

  const content = `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
      <tr>
        <td align="center">
          <table cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="background-color:#EAF3DE;border-radius:50%;width:48px;height:48px;text-align:center;vertical-align:middle;">
                <span style="font-size:22px;line-height:48px;">&#10003;</span>
              </td>
            </tr>
          </table>
          <p style="font-family:Arial,sans-serif;font-size:20px;font-weight:700;color:#1A2340;margin:12px 0 4px;">Booking confirmed!</p>
          <p style="font-family:Arial,sans-serif;font-size:13px;color:#6B7280;margin:0;">Hi ${name}, your seat is reserved.</p>
        </td>
      </tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" border="1" style="border-collapse:collapse;border-color:#E5E7EB;border-radius:8px;overflow:hidden;">
      ${tableRows}
    </table>`;
  return emailWrapper(content);
}

module.exports = { sendEmail, otpTemplate, welcomeTemplate, bookingConfirmTemplate };
