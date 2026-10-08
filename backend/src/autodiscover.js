const dns = require("dns").promises;
const { ImapFlow } = require("imapflow");
const nodemailer = require("nodemailer");

const SELF_SIGNED = process.env.ALLOW_SELF_SIGNED === "true";

// Well-known providers (fast path, works offline)
const BUILTIN = {
  "gmail.com": ["imap.gmail.com", 993, true, "smtp.gmail.com", 465, true],
  "googlemail.com": ["imap.gmail.com", 993, true, "smtp.gmail.com", 465, true],
  "outlook.com": [
    "outlook.office365.com",
    993,
    true,
    "smtp-mail.outlook.com",
    587,
    false,
  ],
  "hotmail.com": [
    "outlook.office365.com",
    993,
    true,
    "smtp-mail.outlook.com",
    587,
    false,
  ],
  "live.com": [
    "outlook.office365.com",
    993,
    true,
    "smtp-mail.outlook.com",
    587,
    false,
  ],
  "yahoo.com": [
    "imap.mail.yahoo.com",
    993,
    true,
    "smtp.mail.yahoo.com",
    465,
    true,
  ],
  "icloud.com": ["imap.mail.me.com", 993, true, "smtp.mail.me.com", 587, false],
  "me.com": ["imap.mail.me.com", 993, true, "smtp.mail.me.com", 587, false],
  "gmx.de": ["imap.gmx.net", 993, true, "mail.gmx.net", 465, true],
  "gmx.net": ["imap.gmx.net", 993, true, "mail.gmx.net", 465, true],
  "web.de": ["imap.web.de", 993, true, "smtp.web.de", 587, false],
  "t-online.de": [
    "secureimap.t-online.de",
    993,
    true,
    "securesmtp.t-online.de",
    465,
    true,
  ],
  "1und1.de": ["imap.1und1.de", 993, true, "smtp.1und1.de", 465, true],
  "online.de": ["imap.1und1.de", 993, true, "smtp.1und1.de", 465, true],
  "freenet.de": ["mx.freenet.de", 993, true, "mx.freenet.de", 465, true],
  "posteo.de": ["posteo.de", 993, true, "posteo.de", 465, true],
  "mailbox.org": ["imap.mailbox.org", 993, true, "smtp.mailbox.org", 465, true],
  "ionos.de": ["imap.ionos.de", 993, true, "smtp.ionos.de", 465, true],
};

function builtinConfig(domain, email) {
  const b = BUILTIN[domain];
  if (!b) return null;
  return {
    source: "builtin",
    imap: { host: b[0], port: b[1], secure: b[2], user: email },
    smtp: { host: b[3], port: b[4], secure: b[5], user: email },
  };
}

/** Parses Mozilla autoconfig XML (config-v1.1.xml) */
function parseConfig(xml, email) {
  const [local, domain] = email.split("@");
  const sub = (s) =>
    s
      .replace(/%EMAILADDRESS%/g, email)
      .replace(/%EMAILLOCALPART%/g, local)
      .replace(/%EMAILDOMAIN%/g, domain);
  const block = (tag, type) => {
    const m = xml.match(
      new RegExp(`<${tag}\\s+type="${type}"[^>]*>([\\s\\S]*?)</${tag}>`, "i"),
    );
    return m ? m[1] : null;
  };
  const val = (b, t) => {
    const m = b.match(new RegExp(`<${t}>\\s*([^<]*?)\\s*</${t}>`, "i"));
    return m ? m[1] : null;
  };
  const inc = block("incomingServer", "imap");
  const out = block("outgoingServer", "smtp");
  if (!inc || !out) return null;
  const mk = (b) => {
    const socket = (val(b, "socketType") || "SSL").toUpperCase();
    const host = val(b, "hostname");
    const port = parseInt(val(b, "port"), 10);
    if (!host || !port || !["SSL", "STARTTLS"].includes(socket)) return null;
    return {
      host: sub(host),
      port,
      secure: socket === "SSL",
      user: sub(val(b, "username") || "%EMAILADDRESS%"),
    };
  };
  const imap = mk(inc);
  const smtp = mk(out);
  return imap && smtp ? { source: "autoconfig", imap, smtp } : null;
}

async function fetchConfig(url, email) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    return parseConfig(await res.text(), email);
  } catch {
    return null;
  }
}

const ISPDB = (d) => `https://autoconfig.thunderbird.net/v1.1/${d}`;

/** Returns an ordered list of candidate server configurations */
async function discover(email) {
  const domain = email.split("@")[1].toLowerCase();
  const list = [];

  const builtin = builtinConfig(domain, email);
  if (builtin) list.push(builtin);

  const [own, wellKnown, ispdb] = await Promise.all([
    fetchConfig(
      `https://autoconfig.${domain}/mail/config-v1.1.xml?emailaddress=${encodeURIComponent(email)}`,
      email,
    ),
    fetchConfig(
      `https://${domain}/.well-known/autoconfig/mail/config-v1.1.xml`,
      email,
    ),
    fetchConfig(ISPDB(domain), email),
  ]);
  [own, wellKnown, ispdb].forEach((c) => c && list.push(c));

  // Hosted domains: use the MX provider's configuration
  if (!list.length) {
    try {
      const mx = await dns.resolveMx(domain);
      mx.sort((a, b) => a.priority - b.priority);
      if (mx.length) {
        const base = mx[0].exchange
          .toLowerCase()
          .split(".")
          .slice(-2)
          .join(".");
        if (base !== domain) {
          const c =
            builtinConfig(base, email) ||
            (await fetchConfig(ISPDB(base), email));
          if (c) list.push(c);
        }
      }
    } catch {
      /* ignore */
    }
  }

  // Last resort: common host names
  for (const h of [`imap.${domain}`, `mail.${domain}`, domain]) {
    const smtpHost = h.startsWith("imap.") ? `smtp.${domain}` : h;
    list.push({
      source: "guess",
      imap: { host: h, port: 993, secure: true, user: email },
      smtp: { host: smtpHost, port: 465, secure: true, user: email },
    });
  }
  return list;
}

async function testImap(cfg, user, pass) {
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    doSTARTTLS: !cfg.secure,
    auth: { user, pass },
    logger: false,
    tls: { rejectUnauthorized: !SELF_SIGNED },
    connectionTimeout: 10000,
    greetingTimeout: 8000,
    socketTimeout: 15000,
  });
  client.on("error", () => {});
  try {
    await client.connect();
    await client.logout();
    return { ok: true };
  } catch (e) {
    try {
      client.close();
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      authFailed: !!e.authenticationFailed,
      error: e.responseText || e.message,
    };
  }
}

async function verifySmtp(smtp, user, pass) {
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    requireTLS: !smtp.secure,
    auth: { user, pass },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 10000,
    tls: { rejectUnauthorized: !SELF_SIGNED },
  });
  try {
    await transport.verify();
    return true;
  } catch {
    return false;
  } finally {
    transport.close();
  }
}

async function pickSmtp(cfg, imapUser, pass) {
  const base = cfg.smtp;
  const user = base.user === cfg.imap.user ? imapUser : base.user;
  const candidates = [
    base,
    { ...base, port: 587, secure: false },
    { ...base, port: 465, secure: true },
  ].filter(
    (c, i, arr) =>
      arr.findIndex((x) => x.port === c.port && x.secure === c.secure) === i,
  );
  for (const c of candidates) {
    if (await verifySmtp(c, user, pass)) return { ...c, user };
  }
  return null;
}

/**
 * Discovers IMAP/SMTP settings and verifies the credentials.
 * Resolves with { imap, smtp } or throws { code: 'auth' | 'connect', message }.
 */
async function resolveAccount(email, password) {
  const configs = await discover(email);
  let authError = null;
  let connectError = null;

  for (const cfg of configs) {
    const users = [...new Set([cfg.imap.user, email])];
    for (const user of users) {
      const r = await testImap(cfg.imap, user, password);
      if (r.ok) {
        const smtp = await pickSmtp(cfg, user, password);
        if (!smtp)
          throw {
            code: "smtp",
            message: "SMTP authentication or connection failed",
          };
        return { imap: { ...cfg.imap, user }, smtp };
      }
      if (r.authFailed) {
        authError = r;
        continue;
      }
      connectError = r;
      break;
    }
    if (authError) break; // server reached but credentials rejected
  }

  if (authError) throw { code: "auth", message: authError.error };
  throw {
    code: "connect",
    message: connectError ? connectError.error : "No server found",
  };
}

module.exports = { resolveAccount, parseConfig };
