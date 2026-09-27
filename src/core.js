'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
function vault(secret) {
  if (!/^[a-f0-9]{64}$/i.test(secret || '')) throw new Error('ENCRYPTION_KEY must be 64 hex characters');
  const key = Buffer.from(secret, 'hex');
  return {
    seal(value, owner) {
      const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv);
      c.setAAD(Buffer.from(owner));
      const body = Buffer.concat([c.update(value, 'utf8'), c.final()]);
      return [iv, c.getAuthTag(), body].map(b => b.toString('base64')).join('.');
    },
    open(value, owner) {
      const [iv, tag, body] = value.split('.').map(x => Buffer.from(x, 'base64'));
      const c = crypto.createDecipheriv('aes-256-gcm', key, iv);
      c.setAAD(Buffer.from(owner)); c.setAuthTag(tag);
      return Buffer.concat([c.update(body), c.final()]).toString('utf8');
    }
  };
}
class Store {
  constructor(dir) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.file = path.join(dir, 'accounts.json');
    this.data = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : {};
  }
  save() {
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.data), { mode: 0o600 });
    fs.renameSync(this.file + '.tmp', this.file);
  }
  put(id, value) { this.data[id] = value; this.save(); }
  remove(id) { delete this.data[id]; this.save(); }
}
class Gate {
  constructor({channel, bot = '940683219056082954', now = Date.now, command = '+r'}) {
    Object.assign(this, {channel, bot, now, command}); this.pending = null; this.attempted = new Set();
  }
  reset() { this.pending = null; }
  inspect(m) {
    const now = this.now();
    if (m.channelId !== this.channel || !m.guildId || !m.author) return null;
    if (m.content?.trim() === this.command && !m.author.bot) {
      if (now - m.createdTimestamp > 30000 || m.editedTimestamp) return null;
      if (this.lastCommand === m.id) return null;
      this.lastCommand = m.id;
      this.pending = {command:m.id, at:m.createdTimestamp, until:now + 15000};
      return null;
    }
    const p = this.pending;
    if (!p || now > p.until || m.author.id !== this.bot || m.createdTimestamp < p.at) return null;
    if (m.reference?.messageId && m.reference.messageId !== p.command) return null;
    const text = [m.content, ...(m.embeds || []).map(e => [e.title,e.description,...(e.fields || []).map(f=>f.name+' '+f.value)].join(' '))].join(' ');
    if (!/المشاركين/.test(text) || this.attempted.has(m.id)) return null;
    const button = (m.components || []).flatMap(r=>r.components || []).find(b => b.type === 'BUTTON' || b.type === 2 ? b.label?.trim() === 'دخول' && !b.disabled && b.customId : false);
    if (!button) return null;
    this.attempted.add(m.id);
    if (this.attempted.size > 1000) this.attempted.delete(this.attempted.values().next().value);
    this.pending = null; // Consume before awaiting network: no duplicate or automatic retry.
    return button.customId;
  }
}
module.exports = {vault, Store, Gate};
