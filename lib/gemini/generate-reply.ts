import { getGeminiClient, GEMINI_MODELS } from "./client";
import { withGeminiRetry } from "./retry";

export type GenerateReplyInput = {
  commentText: string;
  videoTitle: string;
  authorDisplayName: string;
  // 채널별 답글 톤 — yt_accounts.reply_persona. 빈 값이면 일반 친근 톤.
  replyPersona: string;
};

export type ReplyClassification =
  | "question"
  | "thanks"
  | "compliment"
  | "complaint"
  | "spam"
  | "other";

export type GeneratedReply = {
  reply: string;
  classification: ReplyClassification;
  // false면 사용자에게 추천하지 않음(스팸/욕설/외부 광고 등)
  should_reply: boolean;
  // 모델이 판단한 이유 — UI에서 살짝 보여줘서 검토 도움.
  reason: string;
};

const DEFAULT_PERSONA = `당신은 유튜브 채널 운영자입니다.
- 시청자 댓글에 짧고 따뜻하게 한국어로 답합니다.
- 1~3문장, 60자 이내 권장. 이모지는 0~1개만, 과하지 않게.
- 영업·홍보·외부 링크 금지.
- 시청자에게 진심으로 감사하고 친근하게 응답합니다.`;

function buildSystemPrompt(persona: string): string {
  const personaBlock = persona.trim().length > 0 ? persona.trim() : DEFAULT_PERSONA;
  return `${personaBlock}

[규칙]
- 응답은 반드시 JSON 한 개. 마크다운/설명 금지.
- 스키마:
  {
    "reply": "<댓글에 다는 답글 본문. 위 톤 따름>",
    "classification": "question | thanks | compliment | complaint | spam | other",
    "should_reply": <boolean>,
    "reason": "<왜 그렇게 분류·작성했는지 한 줄>"
  }
- 댓글이 명백한 스팸/광고/욕설/혐오라면 should_reply=false로 설정하고 reply는 빈 문자열.
- 질문(question)에는 가능한 한 짧게 답하되, 정확하지 않으면 "정확한 건 영상을 다시 확인해 주세요" 식으로 둘러대지 말고 솔직하게 안내.
- 시청자 이름은 호명하지 않습니다(YouTube에서 자동 @멘션되므로).`;
}

function buildUserPrompt(input: GenerateReplyInput): string {
  return `[영상 제목]
${input.videoTitle}

[작성자]
${input.authorDisplayName}

[댓글 원문]
${input.commentText}

위 댓글에 어울리는 답글을 JSON으로 출력하세요.`;
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) return fence[1];
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1);
  return trimmed;
}

async function callModel(model: string, system: string, userMsg: string) {
  const client = getGeminiClient();
  return withGeminiRetry(
    () =>
      client.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: userMsg }] }],
        config: {
          systemInstruction: system,
          temperature: 0.7,
          responseMimeType: "application/json",
        },
      }),
    { label: `reply:${model}`, maxAttempts: 3 },
  );
}

export async function generateReply(
  input: GenerateReplyInput,
): Promise<GeneratedReply> {
  const system = buildSystemPrompt(input.replyPersona);
  const userMsg = buildUserPrompt(input);

  // 1차: flash. 503/UNAVAILABLE이 반복되면 2차: flash-lite로 fallback.
  let result;
  try {
    result = await callModel(GEMINI_MODELS.text, system, userMsg);
  } catch (primaryErr) {
    const msg =
      primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
    if (!/503|UNAVAILABLE|overloaded|high demand/i.test(msg)) {
      throw primaryErr;
    }
    console.warn("[gemini] flash 과부하 — flash-lite로 fallback");
    result = await callModel(GEMINI_MODELS.textLite, system, userMsg);
  }

  const raw = result.text ?? "";
  const json = extractJson(raw);
  let parsed: Partial<GeneratedReply>;
  try {
    parsed = JSON.parse(json) as Partial<GeneratedReply>;
  } catch (err) {
    throw new Error(
      `Gemini 답글 JSON 파싱 실패: ${(err as Error).message} | raw=${raw.slice(0, 200)}`,
    );
  }

  const reply = typeof parsed.reply === "string" ? parsed.reply.trim() : "";
  const classification = (parsed.classification ?? "other") as ReplyClassification;
  const shouldReply = parsed.should_reply !== false && reply.length > 0;
  const reason = typeof parsed.reason === "string" ? parsed.reason : "";

  return { reply, classification, should_reply: shouldReply, reason };
}
