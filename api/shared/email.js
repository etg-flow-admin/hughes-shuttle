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
                    <img src="https://book.hughesshuttle.com.au/hughes-logo-icon-blue.png" alt="Hughes Shuttle" style="height:36px;width:36px;object-fit:contain;border-radius:50%;display:block;">
                  </td>
                  <td style="vertical-align:middle;">
                    <span style="color:#ffffff;font-size:17px;font-weight:600;font-family:Arial,sans-serif;letter-spacing:0.03em;">Hughes Shuttle Bus</span>
                  </td>
                </tr>
              </table>
            </td>
            <td align="right" style="vertical-align:middle;">
              <img src="https://book.hughesshuttle.com.au/au-village-logo.png" alt="Adelaide University Village" style="height:32px;object-fit:contain;display:block;">
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

function bookingConfirmTemplate(name, ref, serviceNum, stopName, depTime, travelDate) {
  const depTimeFormatted = formatEmailTime(depTime);
  const dateFormatted = travelDate.split('-').reverse().join('/');
  const rows = [
    ['Reference',   `<strong style="font-family:'Courier New',monospace;">${ref}</strong>`],
    ['Service',     `Service No.${serviceNum}`],
    ['Boarding at', stopName],
    ['Departure',   depTimeFormatted],
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
