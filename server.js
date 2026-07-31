import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';
import {
  listConversations,
  searchConversations,
  createConversation,
  getConversation,
  deleteConversation,
  setEngine,
  appendMessage,
  truncateFrom
} from './store.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

const CHAT_SYSTEM_PROMPT = "You are FunkinHelper, an assistant specialized in Friday Night Funkin' source code: the base Haxe/HaxeFlixel/Lime/OpenFL game, and its major engine forks. You understand HScript and Lua modding APIs used across these engines, JSON chart formats, native extensions, and Android/iOS build toolchains (Gradle, hxcpp, CI via GitHub Actions). Give direct, technically precise help: fix bugs, explain engine internals, write new features, or convert scripts between Lua and HScript. All code you write must be in English, contain no comments, and must never use trace() calls. Keep prose explanations concise and focused on the fix or the concept, not padding.";

const ANALYZE_SYSTEM_PROMPT = "You are FunkinHelper reviewing a single source file from a Friday Night Funkin' project (engine, mod, or tooling code, typically Haxe, HScript, or Lua). Identify real bugs, risky patterns, and concrete improvements. Reference specific lines or symbols from the file. Be direct and avoid generic advice that does not apply to this exact file. All code you suggest must be in English, contain no comments, and must never use trace() calls.";

const ENGINE_CONTEXT = {
  psych: "The user is working specifically with Psych Engine. Favor its HScript conventions, its Note/Character/Stage classes, and its typical folder and mod structure.",
  vslice: "The user is working specifically with V-Slice / Codename Engine. Favor its ScriptedSong and scripted Character system, its module-based HScript scripting, and its Flixel state structure.",
  kade: "The user is working specifically with Kade Engine. Favor its Lua/HScript hybrid modding conventions and its Options/Controls system.",
  forever: "The user is working specifically with Forever Engine. Favor its scripting API and conventions.",
  auto: ''
};

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 300 * 1024 } });

const apiLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX) || 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Wait a bit before trying again.' }
});

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/api/conversations', async (req, res) => {
  const conversations = await listConversations();
  res.json({ conversations });
});

app.get('/api/conversations/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ conversations: await listConversations() });
  const conversations = await searchConversations(q);
  res.json({ conversations });
});

app.post('/api/conversations', async (req, res) => {
  const conversation = await createConversation();
  res.json({ conversation });
});

app.get('/api/conversations/:id', async (req, res) => {
  const conversation = await getConversation(req.params.id);
  if (!conversation) return res.status(404).json({ error: 'Conversation not found.' });
  res.json({ conversation });
});

app.patch('/api/conversations/:id', async (req, res) => {
  const conversation = await setEngine(req.params.id, req.body.engine);
  if (!conversation) return res.status(404).json({ error: 'Conversation not found.' });
  res.json({ conversation });
});

app.delete('/api/conversations/:id', async (req, res) => {
  await deleteConversation(req.params.id);
  res.json({ ok: true });
});

app.delete('/api/conversations/:id/messages/:messageId', async (req, res) => {
  const conversation = await truncateFrom(req.params.id, req.params.messageId);
  if (!conversation) return res.status(404).json({ error: 'Conversation not found.' });
  res.json({ conversation });
});

app.post('/api/chat', apiLimiter, async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY.' });
  }

  const { conversationId, message, messageId, engine } = req.body;

  if (!conversationId || !message) {
    return res.status(400).json({ error: 'conversationId and message are required.' });
  }

  const conversation = await getConversation(conversationId);
  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found.' });
  }

  const effectiveEngine = engine || conversation.engine || 'auto';
  if (effectiveEngine !== conversation.engine) {
    await setEngine(conversationId, effectiveEngine);
  }

  await appendMessage(conversationId, { id: messageId, role: 'user', content: message });

  const upstreamMessages = [...conversation.messages, { role: 'user', content: message }].map(m => ({
    role: m.role,
    content: m.content
  }));

  const systemPrompt = CHAT_SYSTEM_PROMPT + (ENGINE_CONTEXT[effectiveEngine] ? ' ' + ENGINE_CONTEXT[effectiveEngine] : '');

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        system: systemPrompt,
        stream: true,
        messages: upstreamMessages
      })
    });

    if (!upstream.ok || !upstream.body) {
      const errData = await upstream.json().catch(() => ({}));
      return res.status(upstream.status || 500).json({ error: errData.error?.message || 'Anthropic API error.' });
    }

    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6);
        if (payload === '[DONE]') continue;

        try {
          const event = JSON.parse(payload);
          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            fullText += event.delta.text;
            res.write(JSON.stringify({ type: 'delta', text: event.delta.text }) + '\n');
          }
        } catch {
          continue;
        }
      }
    }

    const updatedConversation = await appendMessage(conversationId, { role: 'assistant', content: fullText });
    const assistantMessageId = updatedConversation.messages[updatedConversation.messages.length - 1].id;
    res.write(JSON.stringify({ type: 'done', assistantMessageId }) + '\n');
    res.end();
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to reach the Anthropic API.' });
    } else {
      res.end();
    }
  }
});

app.post('/api/analyze', apiLimiter, upload.single('file'), async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY.' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'No file was uploaded.' });
  }

  const content = req.file.buffer.toString('utf-8').slice(0, 20000);
  const question = (req.body.question || '').slice(0, 500);
  const questionLine = question ? 'Question: ' + question + '\n\n' : '';
  const userContent = 'File: ' + req.file.originalname + '\n\n' + questionLine + '```\n' + content + '\n```';

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        system: ANALYZE_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'Anthropic API error.' });
    }

    const textBlocks = (data.content || []).filter(b => b.type === 'text').map(b => b.text);
    const analysis = textBlocks.join('\n').trim();

    res.json({ analysis, filename: req.file.originalname });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reach the Anthropic API.' });
  }
});

app.listen(PORT, () => {
  console.log('FunkinHelper server running on port ' + PORT);
});
