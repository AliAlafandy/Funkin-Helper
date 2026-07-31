import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, 'data', 'conversations.json');

let cache = null;

async function ensureLoaded() {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf-8');
    cache = JSON.parse(raw);
  } catch {
    cache = {};
  }
  return cache;
}

async function persist() {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(cache, null, 2));
}

export async function listConversations() {
  const data = await ensureLoaded();
  return Object.values(data)
    .map(c => ({ id: c.id, title: c.title, updatedAt: c.updatedAt, messageCount: c.messages.length }))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

export async function searchConversations(query) {
  const data = await ensureLoaded();
  const q = query.toLowerCase();
  const results = [];

  for (const conv of Object.values(data)) {
    const titleMatch = conv.title.toLowerCase().includes(q);
    const msgMatch = conv.messages.find(m => m.content.toLowerCase().includes(q));
    if (titleMatch || msgMatch) {
      results.push({
        id: conv.id,
        title: conv.title,
        updatedAt: conv.updatedAt,
        snippet: msgMatch ? msgMatch.content.slice(0, 120) : ''
      });
    }
  }

  return results.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

export async function createConversation() {
  const data = await ensureLoaded();
  const id = randomUUID();
  const now = new Date().toISOString();
  data[id] = { id, title: 'New conversation', engine: 'auto', messages: [], createdAt: now, updatedAt: now };
  await persist();
  return data[id];
}

export async function getConversation(id) {
  const data = await ensureLoaded();
  return data[id] || null;
}

export async function deleteConversation(id) {
  const data = await ensureLoaded();
  delete data[id];
  await persist();
}

export async function setEngine(id, engine) {
  const data = await ensureLoaded();
  const conv = data[id];
  if (!conv) return null;
  conv.engine = engine || 'auto';
  await persist();
  return conv;
}

export async function appendMessage(id, message) {
  const data = await ensureLoaded();
  const conv = data[id];
  if (!conv) return null;
  const stamped = { id: message.id || randomUUID(), role: message.role, content: message.content, createdAt: new Date().toISOString() };
  conv.messages.push(stamped);
  conv.updatedAt = stamped.createdAt;
  if (conv.title === 'New conversation' && message.role === 'user') {
    const trimmed = message.content.slice(0, 48).trim();
    conv.title = trimmed + (message.content.length > 48 ? '…' : '');
  }
  await persist();
  return conv;
}

export async function truncateFrom(id, messageId) {
  const data = await ensureLoaded();
  const conv = data[id];
  if (!conv) return null;
  const idx = conv.messages.findIndex(m => m.id === messageId);
  if (idx !== -1) {
    conv.messages = conv.messages.slice(0, idx);
    conv.updatedAt = new Date().toISOString();
    await persist();
  }
  return conv;
}
