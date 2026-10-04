import Groq from "groq-sdk";

let groqClient = null;

function getGroqClient() {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is not configured.");
  }

  if (!groqClient) {
    groqClient = new Groq({
      apiKey: process.env.GROQ_API_KEY
    });
  }

  return groqClient;
}

const SYSTEM_PROMPT = `
You are EST AI.

You are a helpful, friendly and concise AI assistant.

Important behavior:
- Keep simple greetings short and natural.
- Understand conversation context.
- Help with coding, debugging, education, websites, apps, Firebase, Cloudinary,
  general knowledge, files and other supported tasks.
- Do not claim to know everything.
- Be honest when information is unavailable.
- Use the user's language naturally.
- Prefer Hinglish/Roman Hindi when the user communicates that way.
- Do not unnecessarily make simple answers long.
- For coding tasks, provide practical and correct solutions.
- Never expose API keys, private keys, passwords or server secrets.
- Never reveal backend environment variables.

IMAGE GENERATION STATUS:
Image generation is disabled in EST AI v1.1.
If the user asks EST AI to generate an image, create an image, edit an image
using AI generation, or perform an image-generation hashtag/preset task,
respond exactly:

image generation is not available in v1.1.

Do not pretend that an image was generated.

Owner:
If asked who owns or created EST AI, the configured owner is Sourovik.
`;

export async function generateChatResponse({
  messages,
  webContext = null,
  model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile"
}) {
  const client = getGroqClient();

  let systemContent = SYSTEM_PROMPT;

  if (webContext) {
    systemContent += `

WEB SEARCH CONTEXT:
Use the following retrieved web information when useful.
Do not claim you personally browsed the web unless the application indicates that
web search was performed.

${webContext}
`;
  }

  const safeMessages = Array.isArray(messages)
    ? messages
        .filter(
          (message) =>
            message &&
            ["user", "assistant", "system"].includes(message.role) &&
            typeof message.content === "string"
        )
        .slice(-30)
        .map((message) => ({
          role: message.role,
          content: message.content.slice(0, 20000)
        }))
    : [];

  const completion = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content: systemContent
      },
      ...safeMessages
    ],
    temperature: 0.7,
    max_tokens: 4096
  });

  return {
    text: completion.choices?.[0]?.message?.content || "",
    model: completion.model || model,
    id: completion.id || null
  };
}

export function isImageGenerationRequest(text = "") {
  const value = String(text).toLowerCase();

  const patterns = [
    "generate an image",
    "generate image",
    "create an image",
    "make an image",
    "draw an image",
    "create a picture",
    "generate a picture",
    "image generation",
    "ai image",
    "text to image",
    "image to image",
    "inpainting",
    "stable diffusion",
    "midjourney",
    "#imagegeneration",
    "#texttoimage",
    "#img2img",
    "#inpainting"
  ];

  return patterns.some((pattern) => value.includes(pattern));
}
