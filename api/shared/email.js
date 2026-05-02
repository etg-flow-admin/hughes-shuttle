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
      <td style="padding:16px 28px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="vertical-align:middle;">
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="vertical-align:middle;padding-right:10px;">
                    <img src="data:image/png;base64,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" alt="Hughes Shuttle" width="36" height="36" style="height:36px;width:36px;object-fit:contain;border-radius:50%;display:block;">
                  </td>
                  <td style="vertical-align:middle;">
                    <span style="color:#ffffff;font-size:17px;font-weight:600;font-family:Arial,sans-serif;letter-spacing:0.03em;">Hughes Shuttle Bus</span>
                  </td>
                </tr>
              </table>
            </td>
            <td align="right" style="vertical-align:middle;">
              <img src="https://book.hughesshuttle.com.au/au-village-logo.png" alt="Adelaide University Village" width="120" height="32" style="height:32px;width:120px;object-fit:contain;display:block;">
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
        <p style="color:#9CA3AF;font-size:12px;font-family:Arial,sans-serif;margin:0 0 8px;">
          Hughes Shuttle Bus &mdash; <a href="https://book.hughesshuttle.com.au" style="color:#C9A84C;text-decoration:none;">book.hughesshuttle.com.au</a> &mdash; <a href="mailto:info@hughes.com.au" style="color:#C9A84C;text-decoration:none;">info@hughes.com.au</a>
        </p>
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
  const rows = [
    ['Email',               email],
    ['Temporary password',  `<span style="font-family:'Courier New',monospace;background-color:#F5EDD6;padding:3px 10px;border-radius:4px;font-size:15px;letter-spacing:0.05em;">${tempPassword}</span>`],
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
                <span style="font-size:22px;line-height:48px;">&#128075;</span>
              </td>
            </tr>
          </table>
          <p style="font-family:Arial,sans-serif;font-size:20px;font-weight:700;color:#1A2340;margin:12px 0 4px;">Welcome, ${name}!</p>
          <p style="font-family:Arial,sans-serif;font-size:13px;color:#6B7280;margin:0 0 4px;">Your Hughes Shuttle Bus account has been created.</p>
          <p style="font-family:Arial,sans-serif;font-size:13px;color:#6B7280;margin:0;">Sign in with the details below and change your password after your first login.</p>
        </td>
      </tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" border="1" style="border-collapse:collapse;border-color:#E5E7EB;border-radius:8px;overflow:hidden;margin-bottom:20px;">
      ${tableRows}
    </table>
    <p style="font-family:Arial,sans-serif;font-size:12px;color:#9CA3AF;text-align:center;margin:0 0 12px;">For security, please do not share your temporary password with anyone.</p>
    <p style="font-family:Arial,sans-serif;font-size:13px;text-align:center;margin:0;">
      <a href="https://book.hughesshuttle.com.au" style="background-color:#C9A84C;color:#1A2340;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:700;font-family:Arial,sans-serif;display:inline-block;">Sign in to Hughes Shuttle Bus</a>
    </p>`;
  return emailWrapper(content);
}

// ── Booking confirmation email ──
function formatEmailTime(t) {
  if (!t || t === '—') return t || '—';
  const [hStr, mStr] = t.replace(/^0/, '').split(':');
  const h = parseInt(hStr), m = mStr || '00';
  const ampm = h < 12 ? 'am' : 'pm';
  const h12  = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return String(h12).padStart(2,'0') + ':' + m + ' ' + ampm;
}

function bookingConfirmTemplate(name, ref, serviceNum, boardingStopName, alightingStopName, depTime, travelDate, cancelUrl) {
  const depTimeFormatted = formatEmailTime(depTime);
  const dateFormatted = travelDate.split('-').reverse().join('/');
  const rows = [
    ['Reference',       `<strong style="font-family:'Courier New',monospace;">${ref}</strong>`],
    ['Service',         `Service No.${serviceNum}`],
    ['Getting on at',  boardingStopName],
    ['Getting off at', alightingStopName],
    ['Departure',       depTimeFormatted],
    ['Date',            dateFormatted],
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
    </table>
    <p style="font-family:Arial,sans-serif;font-size:13px;color:#6B7280;text-align:center;margin:20px 0 0;">
      Need to cancel? <a href="${cancelUrl}" style="color:#A32D2D;font-weight:600;">Cancel this booking</a>
    </p>`;
  return emailWrapper(content);
}
// ── Password reset email ──
function passwordResetTemplate(name, otp) {
  const content = `
    <p style="font-family:Arial,sans-serif;font-size:20px;font-weight:700;color:#1A2340;margin:0 0 8px;">Reset your password</p>
    <p style="font-family:Arial,sans-serif;font-size:14px;color:#6B7280;margin:0 0 28px;line-height:1.6;">
      Hi ${name || 'there'},<br>
      We received a request to reset your Hughes Shuttle Bus password. Use the code below on the password reset page.
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
    <p style="font-family:Arial,sans-serif;font-size:13px;color:#6B7280;text-align:center;margin:0 0 20px;">
      This code expires in <strong style="color:#1A2340;">10 minutes</strong>. Do not share it with anyone.
    </p>
    <p style="font-family:Arial,sans-serif;font-size:13px;text-align:center;margin:0 0 16px;">
      <a href="https://book.hughesshuttle.com.au" style="background-color:#C9A84C;color:#1A2340;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-family:Arial,sans-serif;display:inline-block;">Go to Hughes Shuttle Bus</a>
    </p>
    <p style="font-family:Arial,sans-serif;font-size:12px;color:#9CA3AF;text-align:center;margin:0;">
      Click <strong>Forgot password?</strong> on the sign-in page, then enter your email and this code.<br>
      If you didn't request this, you can safely ignore this email.
    </p>`;
  return emailWrapper(content);
}

module.exports = { sendEmail, otpTemplate, passwordResetTemplate, welcomeTemplate, bookingConfirmTemplate };
