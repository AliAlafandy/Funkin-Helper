import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

const SYSTEM_PROMPT = "You are FunkinHelper, an assistant specialized in Friday Night Funkin' source code: the base Haxe/HaxeFlixel/Lime/OpenFL game, and its major engine forks (Psych Engine, V-Slice/Codename Engine, Kade Engine, Forever Engine, and mobile ports of these). You understand HScript and Lua modding APIs used across these engines, JSON chart formats, native extensions, and Android/iOS build toolchains (Gradle, hxcpp, CI via GitHub Actions). Give direct, technically precise help: fix bugs, explain engine internals, write new features, or convert scripts between Lua and HScript. All code you write must be in English, contain no comments, and must never use trace() calls. Keep prose explanations concise and focused on the fix or the concept, not padding.";

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/chat', async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY.' });
  }

  const { messages } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages must be a non-empty array.' });
  }

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
        system: SYSTEM_PROMPT,
        messages
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'Anthropic API error.' });
    }

    const textBlocks = (data.content || []).filter(b => b.type === 'text').map(b => b.text);
    const reply = textBlocks.join('\n').trim();

    return res.json({ reply });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to reach the Anthropic API.' });
  }
});

app.listen(PORT, () => {
  console.log(`FunkinHelper server running on port ${PORT}`);
});
