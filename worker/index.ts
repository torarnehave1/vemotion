import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Env = {
  VIDEO_CACHE: KVNamespace;
  DB: D1Database;
  VIDEOS: R2Bucket;
  AI: Ai;
  MAX_DURATION: string;
  FRAME_RATE: string;
};

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors());

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok' });
});

// Create a new video render job
app.post('/api/video/create', async (c) => {
  try {
    const composition = await c.req.json();

    // Validate composition
    if (!composition.duration || !composition.fps) {
      return c.json(
        { error: 'Missing required fields: duration, fps' },
        { status: 400 }
      );
    }

    // Generate unique video ID
    const videoId = `vid_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    // Store composition in KV for later retrieval
    await c.env.VIDEO_CACHE.put(
      `composition:${videoId}`,
      JSON.stringify(composition),
      { expirationTtl: 86400 } // 24 hours
    );

    return c.json({
      videoId,
      status: 'queued',
      message: 'Video generation queued. Check status for updates.',
    });
  } catch (error) {
    console.error('Error creating video:', error);
    return c.json(
      { error: 'Failed to create video' },
      { status: 500 }
    );
  }
});

// Get video status
app.get('/api/video/:videoId/status', async (c) => {
  const videoId = c.req.param('videoId');

  try {
    const status = await c.env.VIDEO_CACHE.get(`status:${videoId}`);
    if (!status) {
      return c.json(
        { error: 'Video not found' },
        { status: 404 }
      );
    }

    return c.json(JSON.parse(status));
  } catch (error) {
    console.error('Error fetching status:', error);
    return c.json(
      { error: 'Failed to fetch video status' },
      { status: 500 }
    );
  }
});

// Get video download URL
app.get('/api/video/:videoId/download', async (c) => {
  const videoId = c.req.param('videoId');

  try {
    const url = await c.env.VIDEOS.head(`${videoId}.mp4`);
    if (!url) {
      return c.json(
        { error: 'Video file not found' },
        { status: 404 }
      );
    }

    const downloadUrl = await c.env.VIDEOS.getSignedUrl(`${videoId}.mp4`, {
      expirationTtl: 3600, // 1 hour
    });

    return c.json({ downloadUrl });
  } catch (error) {
    console.error('Error generating download URL:', error);
    return c.json(
      { error: 'Failed to generate download URL' },
      { status: 500 }
    );
  }
});

// AI: Generate a layer from a natural language prompt
app.post('/api/video/generate-layer', async (c) => {
  const { prompt, compositionWidth, compositionHeight, compositionDuration } = await c.req.json();

  if (!prompt) return c.json({ error: 'Missing prompt' }, { status: 400 });

  const systemPrompt = `You are a video composition assistant. Given a description, output a single JSON layer object.

The layer must follow this exact TypeScript type:
{
  type: 'text' | 'shape',
  position: { x: number, y: number },
  size: { width: number, height: number },
  properties: {
    // for text: text, fontSize, color (hex), align ('left'|'center'|'right'), fontWeight
    // for shape: shape ('rect'|'circle'), color (hex)
  },
  animation?: {
    property: 'opacity' | 'offsetX' | 'offsetY',
    keyframes: Array<{ time: number, value: number }>
  }
}

Canvas is ${compositionWidth}x${compositionHeight}px. Duration is ${compositionDuration}s.

Animation rules:
- Fade in: opacity 0→1 over first 1s
- Fade out: opacity 1→0 over last 1s
- Slide from left: offsetX from -(width+100) to 0 over 1s
- Slide from right: offsetX from (canvasWidth+100) to 0 over 1s
- Slide from top: offsetY from -(height+100) to 0 over 1s
- Slide from bottom: offsetY from (canvasHeight+100) to 0 over 1s

Respond ONLY with valid JSON, no explanation, no markdown, no code blocks.`;

  try {
    const response = await c.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      max_tokens: 512,
    });

    const raw = (response as any).response as string;

    // Extract JSON from response (model might wrap it)
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in AI response');

    const layer = JSON.parse(jsonMatch[0]);

    return c.json({ layer });
  } catch (error) {
    console.error('AI generation error:', error);
    return c.json({ error: 'Failed to generate layer from prompt' }, { status: 500 });
  }
});

// List templates
app.get('/api/templates', async (c) => {
  try {
    // TODO: Fetch templates from D1 or KV
    return c.json({
      templates: [
        {
          id: 'template-1',
          name: 'Simple Fade',
          description: 'Simple fade-in/fade-out text animation',
        },
      ],
    });
  } catch (error) {
    console.error('Error fetching templates:', error);
    return c.json(
      { error: 'Failed to fetch templates' },
      { status: 500 }
    );
  }
});

// Get single template
app.get('/api/templates/:templateId', async (c) => {
  const templateId = c.req.param('templateId');

  try {
    // TODO: Fetch template from D1 or KV
    return c.json({
      id: templateId,
      name: 'Simple Fade',
      composition: {
        duration: 5,
        fps: 30,
        width: 1280,
        height: 720,
        layers: [],
      },
    });
  } catch (error) {
    console.error('Error fetching template:', error);
    return c.json(
      { error: 'Failed to fetch template' },
      { status: 500 }
    );
  }
});

export default app;
