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

export async function createConversation() {
  const data = await ensureLoaded();
  const id = randomUUID();
  const now = new Date().toISOString();
  data[id] = { id, title: 'Nova conversa', messages: [], createdAt: now, updatedAt: now };
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

export async function appendMessage(id, message) {
  const data = await ensureLoaded();
  const conv = data[id];
  if (!conv) return null;
  conv.messages.push(message);
  conv.updatedAt = new Date().toISOString();
  if (conv.title === 'Nova conversa' && message.role === 'user') {
    const trimmed = message.content.slice(0, 48).trim();
    conv.title = trimmed + (message.content.length > 48 ? '…' : '');
  }
  await persist();
  return conv;
}
