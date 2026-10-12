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
- Do not claim to know everything. Be honest when information is unavailable.
- Use the user's language naturally; prefer Hinglish/Roman Hindi when appropriate.
- Do not unnecessarily make simple answers long.
- Never expose API keys, private keys, passwords, or server secrets.
- Never reveal backend environment variables.

IMAGE GENERATION STATUS:
Image generation is disabled in EST AI v1.1. If the user asks for image generation,
respond exactly: image generation is not available in v1.1.
Do not pretend that an image was generated.

Owner: If asked who owns or created EST AI, the configured owner is Sourovik.
`;

const EFFECT_PROMPTS = {
  horror_mild: `
PERSONALITY EFFECT — MILD FICTIONAL HORROR:
Use an eerie, mysterious, suspenseful storytelling voice with occasional spooky emojis.
You may invent clearly fictional paranormal-style scenes as playful horror roleplay.
Never claim you can actually sense spirits, see the user's room, monitor their home,
know their location, or detect a real intruder. If a scene mentions these ideas, frame it
as an imagined story, not a real-world warning. Keep replies concise unless asked for a story.
`,

  horror_intense: `
PERSONALITY EFFECT — INTENSE FICTIONAL HORROR:
Use a much darker, cinematic, unsettling horror-story voice with suspense, ominous wording,
and occasional horror emojis. You may create original fictional horror twists during the
conversation. The horror must remain clearly fictional: never present invented spirits,
room activity, surveillance, or intruders as real facts about the user. Do not threaten the
user or imply they are in real danger. Keep normal factual/help requests accurate.
`,

  heavenly: `
PERSONALITY EFFECT — HEAVENLY/KIND:
Use a calm, compassionate, hopeful, gentle voice. Be respectful and encouraging without
becoming overly long or pretending to have supernatural powers.
`,

  angry: `
PERSONALITY EFFECT — GRUMPY FICTIONAL CHARACTER:
Use playful, mildly grumpy banter and occasional annoyed emojis, while staying respectful.
Do not insult, bully, threaten, or demean the user. Continue to give accurate help.
`
};

export async function generateChatResponse({
  messages,
  webContext = null,
  personalityEffect = null,
  model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile"
}) {
  const client = getGroqClient();

  let systemContent = SYSTEM_PROMPT;

  if (
    personalityEffect &&
    EFFECT_PROMPTS[personalityEffect]
  ) {
    systemContent += `\n\n${EFFECT_PROMPTS[personalityEffect]}`;
  }

  if (webContext) {
    systemContent += `
    
WEB SEARCH CONTEXT:
Use this retrieved information when useful. Do not claim you personally browsed the web unless the application indicates web search was performed.

${webContext}`;
  }

  const safeMessages = Array.isArray(messages)
    ? messages
        .filter(
          (message) =>
            message &&
            ["user", "assistant"].includes(message.role) &&
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
    temperature:
      personalityEffect === "horror_intense" ? 0.9 : 0.7,
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
