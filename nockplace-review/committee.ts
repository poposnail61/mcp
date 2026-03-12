/**
 * Nockplace Committee Review — Multi-Agent Debate Runner
 *
 * 사용법:
 *   npx ts-node nockplace-review/committee.ts "안건 내용"
 *   npx ts-node nockplace-review/committee.ts "지도 핀 스레드 미리보기" --experts fe,be
 *
 * 환경변수:
 *   ANTHROPIC_API_KEY  (필수)
 */

import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";

// ─────────────────────────────────────────────
// 경로 설정
// ─────────────────────────────────────────────
const BASE_DIR = path.join(__dirname);
const AGENTS_DIR = path.join(BASE_DIR, "agents");
const CONTEXT_FILE = path.join(BASE_DIR, "context", "nockplace-context.md");

const client = new Anthropic();

// ─────────────────────────────────────────────
// 유틸: 마크다운 파일 파싱 (YAML frontmatter 제거)
// ─────────────────────────────────────────────
function extractPromptFromMd(filePath: string): string {
  const raw = fs.readFileSync(filePath, "utf-8");
  const parts = raw.split("---");
  // parts[0] = "" | parts[1] = frontmatter | parts[2..] = body
  if (parts.length >= 3) {
    return parts.slice(2).join("---").trim();
  }
  return raw.trim();
}

// ─────────────────────────────────────────────
// 에이전트 타입
// ─────────────────────────────────────────────
interface Agent {
  role: string;
  label: string;
  system: string;
  history: Anthropic.MessageParam[];
}

function buildAgent(role: string, label: string): Agent {
  const nockplaceCtx = fs.readFileSync(CONTEXT_FILE, "utf-8");
  const rolePrompt = extractPromptFromMd(
    path.join(AGENTS_DIR, `${role}.md`)
  );
  return {
    role,
    label,
    system: `${nockplaceCtx}\n\n---\n\n${rolePrompt}`,
    history: [],
  };
}

// ─────────────────────────────────────────────
// 에이전트 호출 — 스트리밍 출력
// ─────────────────────────────────────────────
async function call(agent: Agent, userMsg: string): Promise<string> {
  agent.history.push({ role: "user", content: userMsg });

  const stream = client.messages.stream({
    model: "claude-opus-4-6",
    max_tokens: 1024,
    thinking: { type: "adaptive" },
    system: agent.system,
    messages: agent.history,
  });

  process.stdout.write(`\n**${agent.label}**: `);
  let text = "";

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      process.stdout.write(event.delta.text);
      text += event.delta.text;
    }
  }
  process.stdout.write("\n");

  const final = await stream.finalMessage();
  // full content (thinking + text blocks) 유지해야 다음 turn에서 올바른 context 전달
  agent.history.push({ role: "assistant", content: final.content });

  return text;
}

// ─────────────────────────────────────────────
// 위원회 리뷰 오케스트레이터
// ─────────────────────────────────────────────
async function runCommitteeReview(
  agenda: string,
  expertRoles: string[] = []
): Promise<void> {
  // ── Step 1: 난이도 판단 ──────────────────────
  const isComplex = agenda.length > 20 || expertRoles.length > 0;
  const totalRounds = isComplex ? 5 : 3;
  const expertLabels: Record<string, string> = {
    fe: "FE",
    be: "BE",
    ops: "OPS",
    marketing: "마케팅",
    sales: "세일즈",
  };

  console.log(`\n## 안건: ${agenda}`);
  console.log(
    `난이도 판단: ${isComplex ? "복잡한 피쳐" : "단순 개선"} → ${totalRounds}라운드 진행`
  );
  if (expertRoles.length > 0) {
    const names = expertRoles.map((r) => expertLabels[r] ?? r).join(", ");
    console.log(`자문 소집 예정: ${names}`);
  } else {
    console.log("자문 소집 예정: 없음 (기본 PO·PD 토론)");
  }

  // ── Step 2: PO ↔ PD 토론 ────────────────────
  const po = buildAgent("po", "PO");
  const pd = buildAgent("pd", "PD");

  let poText = "";
  let pdText = "";

  for (let round = 1; round <= totalRounds; round++) {
    const isEarly = round <= 3;
    const emoji = isEarly ? "🔥" : "🤝";
    console.log(`\n---\n### ${emoji} ${round}라운드`);

    // PO 발언
    let poPrompt: string;
    if (round === 1) {
      poPrompt =
        `안건: "${agenda}"\n\n` +
        `1라운드입니다. 절대 타협 없이 비즈니스 임팩트·지표 관점에서 이 안건을 강하게 주장하세요.`;
    } else if (isEarly) {
      poPrompt =
        `[${round}라운드] PD 주장:\n"${pdText}"\n\n` +
        `PD 주장의 치명적 약점을 수치와 퍼널 데이터로 공략하세요. 절대 양보 금지.`;
    } else {
      poPrompt =
        `[${round}라운드 — 조율 단계] PD 주장:\n"${pdText}"\n\n` +
        `PD 요구사항을 반영하면서도 비즈니스 임팩트를 극대화할 절충안을 제시하세요.`;
    }
    poText = await call(po, poPrompt);

    // PD 발언
    let pdPrompt: string;
    if (round === 1) {
      pdPrompt =
        `안건: "${agenda}"\n\nPO 주장:\n"${poText}"\n\n` +
        `1라운드입니다. 절대 타협 없이 UX·사용성 관점에서 PO 주장의 허점을 반박하세요.`;
    } else if (isEarly) {
      pdPrompt =
        `[${round}라운드] PO 주장:\n"${poText}"\n\n` +
        `PO 주장의 UX 위험을 실제 유저 시나리오로 논박하세요. 절대 양보 금지.`;
    } else {
      pdPrompt =
        `[${round}라운드 — 조율 단계] PO 주장:\n"${poText}"\n\n` +
        `PO 요구사항을 반영하면서도 UX 최저선을 지킬 절충안을 제시하세요.`;
    }
    pdText = await call(pd, pdPrompt);
  }

  // ── 최종 합의 ────────────────────────────────
  console.log("\n---\n### ✅ 최종 합의 (MVP)");

  const finalPoText = await call(
    po,
    `토론이 마무리됩니다. 지금까지의 논의를 바탕으로 MVP 합의안을 제안해주세요.\n` +
      `형식: 포함 / 제외(다음 이터레이션) / 핵심 스펙`
  );

  await call(
    pd,
    `PO 합의안:\n"${finalPoText}"\n\n` +
      `PO 합의안에 최종 동의하거나, 꼭 필요한 UX 조건을 달아 수정안을 제시해주세요.`
  );

  // ── Step 3: 전문가 자문 ──────────────────────
  if (expertRoles.length > 0) {
    for (const role of expertRoles) {
      const label = expertLabels[role] ?? role.toUpperCase();
      const expert = buildAgent(role, label);

      console.log(`\n---\n### 🔍 ${label} 자문 1R`);
      const expertText = await call(
        expert,
        `안건: "${agenda}"\n\n지금까지 PO·PD 논의 내용:\n` +
          `- PO 최종: "${finalPoText}"\n\n` +
          `${label} 전문가 관점에서 리스크와 기회를 구체적으로 지적하세요.`
      );

      console.log(`\n### 💬 PO/PD 반응 2R`);
      const poReaction = await call(
        po,
        `${label} 자문:\n"${expertText}"\n\n이 자문에 대한 PO 입장을 밝히세요.`
      );
      await call(
        pd,
        `${label} 자문:\n"${expertText}"\nPO 반응:\n"${poReaction}"\n\nPD 입장에서 반응하세요.`
      );

      console.log(`\n### ✔️ ${label} 최종 승인 3R`);
      await call(
        expert,
        `PO·PD 반응을 검토했습니다. 최종 의견과 실무 주의사항을 정리해주세요.`
      );
    }
  }

  console.log("\n\n--- 위원회 종료 ---\n");
}

// ─────────────────────────────────────────────
// CLI 진입점
// ─────────────────────────────────────────────
(async () => {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error(
      "사용법: npx ts-node nockplace-review/committee.ts \"안건\" [--experts fe,be,ops,marketing,sales]"
    );
    process.exit(1);
  }

  const agenda = args[0];
  const expertIdx = args.indexOf("--experts");
  const experts =
    expertIdx !== -1 && args[expertIdx + 1]
      ? args[expertIdx + 1].split(",").map((s) => s.trim())
      : [];

  await runCommitteeReview(agenda, experts);
})();
