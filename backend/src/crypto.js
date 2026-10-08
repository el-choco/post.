const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { dataDir } = require("./db");

// Key comes from SECRET_KEY env var, otherwise a random key is generated once in data/secret.key
function loadKey() {
  if (process.env.SECRET_KEY) {
    return crypto.createHash("sha256").update(process.env.SECRET_KEY).digest();
  }
  const file = path.join(dataDir, "secret.key");
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, crypto.randomBytes(32).toString("hex"), {
      mode: 0o600,
    });
  }
  return Buffer.from(fs.readFileSync(file, "utf8").trim(), "hex");
}

const key = loadKey();

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, enc].map((b) => b.toString("base64")).join(".");
}

function decrypt(payload) {
  const [iv, tag, enc] = payload
    .split(".")
    .map((s) => Buffer.from(s, "base64"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString(
    "utf8",
  );
}

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

module.exports = { encrypt, decrypt, sha256 };
