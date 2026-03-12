/**
 * Nockplace Committee Review — Multi-Agent Debate Runner
 *
 * 사용법:
 *   npx ts-node nockplace-review/committee.ts "안건 내용"
 *   npx ts-node nockplace-review/committee.ts "안건" --experts fe,be
 *   npx ts-node nockplace-review/committee.ts "안건" --rounds 5
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
// 유틸: 마크다운 파일에서 YAML frontmatter 제거 후 본문 반환
// ─────────────────────────────────────────────
function extractBody(filePath: string): string {
  const raw = fs.readFileSync(filePath, "utf-8");
  const parts = raw.split("---");
  return parts.length >= 3 ? parts.slice(2).join("---").trim() : raw.trim();
}

// ─────────────────────────────────────────────
// 에이전트 타입
// ─────────────────────────────────────────────
interface Agent {
  label: string;
  system: string;
  history: Anthropic.MessageParam[];
}

function buildAgent(role: string, label: string): Agent {
  const ctx = fs.readFileSync(CONTEXT_FILE, "utf-8");
  const rolePrompt = extractBody(path.join(AGENTS_DIR, `${role}.md`));
  return {
    label,
    system: `${ctx}\n\n---\n\n${rolePrompt}`,
    history: [],
  };
}

// ─────────────────────────────────────────────
// 에이전트 호출 — 스트리밍 실시간 출력
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
  // thinking 블록을 포함한 전체 content 보존 (다음 turn context 유지)
  agent.history.push({ role: "assistant", content: final.content });

  return text;
}

// ─────────────────────────────────────────────
// 합의 감지: 두 응답을 보고 Claude에게 판단 요청
// ─────────────────────────────────────────────
async function detectConsensus(
  agenda: string,
  poText: string,
  pdText: string,
  round: number
): Promise<boolean> {
  if (round < 2) return false; // 1라운드는 항상 계속

  const resp = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 10,
    messages: [
      {
        role: "user",
        content:
          `안건: "${agenda}"\n` +
          `PO: "${poText.slice(0, 300)}"\n` +
          `PD: "${pdText.slice(0, 300)}"\n\n` +
          `두 사람이 MVP 합의에 실질적으로 도달했는가? yes 또는 no 한 단어만 답하라.`,
      },
    ],
  });
  const answer =
    resp.content[0].type === "text"
      ? resp.content[0].text.trim().toLowerCase()
      : "";
  return answer.startsWith("yes");
}

// ─────────────────────────────────────────────
// 위원회 리뷰 오케스트레이터
// ─────────────────────────────────────────────
async function runCommitteeReview(
  agenda: string,
  expertRoles: string[],
  maxRounds: number
): Promise<void> {
  const expertLabels: Record<string, string> = {
    fe: "FE",
    be: "BE",
    ops: "OPS",
    marketing: "마케팅",
    sales: "세일즈",
  };

  // ── Step 1: 난이도 판단 ──────────────────────
  const isComplex = agenda.length > 20 || expertRoles.length > 0;

  console.log(`\n## 안건: ${agenda}`);
  console.log(
    `난이도 판단: ${isComplex ? "복잡한 피쳐" : "단순 개선"} → 최대 ${maxRounds}라운드`
  );
  console.log(
    expertRoles.length > 0
      ? `자문 소집 예정: ${expertRoles.map((r) => expertLabels[r] ?? r).join(", ")}`
      : "자문 소집 예정: 없음"
  );

  // ── Step 2: PO ↔ PD 토론 ────────────────────
  const po = buildAgent("po", "PO");
  const pd = buildAgent("pd", "PD");

  let poText = "";
  let pdText = "";
  let consensusReached = false;

  for (let round = 1; round <= maxRounds; round++) {
    const emoji = round === 1 ? "🎤" : "🔥";
    console.log(`\n---\n### ${emoji} ${round}라운드`);

    // PO 발언
    if (round === 1) {
      poText = await call(
        po,
        `안건: "${agenda}"\n\n` +
          `1라운드입니다. 비즈니스 임팩트·지표·퍼널 관점에서 ` +
          `이 안건에 대한 핵심 입장을 구체적 수치와 함께 제시하세요. ` +
          `(이 라운드는 상대 논박보다 자신의 주장 정립에 집중)`
      );
    } else {
      poText = await call(
        po,
        `[${round}라운드] PD 주장:\n"${pdText}"\n\n` +
          `PD 주장 중 수용 가능한 부분은 인정하고, ` +
          `수용 불가한 부분은 데이터로 반박하세요. ` +
          `합의 가능하다면 절충안을 제시하세요.`
      );
    }

    // PD 발언
    if (round === 1) {
      pdText = await call(
        pd,
        `안건: "${agenda}"\n\nPO 주장:\n"${poText}"\n\n` +
          `1라운드입니다. UX·사용성·인지 부하 관점에서 ` +
          `핵심 입장을 실제 유저 시나리오로 제시하세요. ` +
          `(이 라운드는 상대 논박보다 자신의 주장 정립에 집중)`
      );
    } else {
      pdText = await call(
        pd,
        `[${round}라운드] PO 주장:\n"${poText}"\n\n` +
          `PO 주장 중 수용 가능한 부분은 인정하고, ` +
          `UX 최저선이 위협받는 부분만 집중 반박하세요. ` +
          `합의 가능하다면 절충안을 제시하세요.`
      );
    }

    // 합의 감지
    consensusReached = await detectConsensus(agenda, poText, pdText, round);
    if (consensusReached) {
      console.log(`\n  ↳ ${round}라운드에서 합의 감지 → 최종 합의로 이동`);
      break;
    }
  }

  // 7라운드까지 미합의 시 진행자 직권 정리
  if (!consensusReached) {
    console.log(`\n  ↳ 최대 라운드 도달 → 진행자 직권 정리`);
  }

  // ── 최종 합의 ────────────────────────────────
  console.log("\n---\n### ✅ 최종 합의 (MVP)");

  const finalPoText = await call(
    po,
    `토론을 마무리합니다. 지금까지 논의를 바탕으로 MVP 합의안을 제안해주세요.\n` +
      `형식: 포함 / 제외(다음 이터레이션) / 핵심 스펙`
  );

  await call(
    pd,
    `PO 합의안:\n"${finalPoText}"\n\n` +
      `동의하거나, 꼭 필요한 UX 조건을 달아 최종 의견을 주세요.`
  );

  // ── Step 3: 전문가 자문 ──────────────────────
  for (const role of expertRoles) {
    const label = expertLabels[role] ?? role.toUpperCase();
    const expert = buildAgent(role, label);

    console.log(`\n---\n### 🔍 ${label} 자문 1R`);
    const expertText = await call(
      expert,
      `안건: "${agenda}"\n\nPO·PD 최종 합의:\n"${finalPoText}"\n\n` +
        `${label} 전문가 관점에서 리스크와 기회를 구체적으로 지적하세요.`
    );

    console.log(`\n### 💬 PO/PD 반응 2R`);
    const poReaction = await call(
      po,
      `${label} 자문:\n"${expertText}"\n\nPO 입장에서 반응해주세요.`
    );
    await call(
      pd,
      `${label} 자문:\n"${expertText}"\nPO 반응:\n"${poReaction}"\n\nPD 입장에서 반응해주세요.`
    );

    console.log(`\n### ✔️ ${label} 최종 승인 3R`);
    await call(
      expert,
      `PO·PD 반응을 검토했습니다. 최종 의견과 실무 주의사항을 정리해주세요.`
    );
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
      [
        "사용법:",
        '  npx ts-node nockplace-review/committee.ts "안건"',
        '  npx ts-node nockplace-review/committee.ts "안건" --experts fe,be,ops',
        '  npx ts-node nockplace-review/committee.ts "안건" --rounds 5',
      ].join("\n")
    );
    process.exit(1);
  }

  const agenda = args[0];

  const expertsIdx = args.indexOf("--experts");
  const experts =
    expertsIdx !== -1 && args[expertsIdx + 1]
      ? args[expertsIdx + 1].split(",").map((s) => s.trim())
      : [];

  const roundsIdx = args.indexOf("--rounds");
  const maxRounds =
    roundsIdx !== -1 && args[roundsIdx + 1]
      ? Math.min(7, Math.max(2, parseInt(args[roundsIdx + 1], 10)))
      : 7;

  await runCommitteeReview(agenda, experts, maxRounds);
})();
